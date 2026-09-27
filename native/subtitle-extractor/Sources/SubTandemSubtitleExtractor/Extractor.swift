import CFFmpeg
import CryptoKit
import Foundation

struct SubtitleCue: Sendable, Equatable {
    let startMilliseconds: Int64
    let endMilliseconds: Int64
    let text: String
    let order: Int
}

private struct MatroskaElement {
    let id: UInt64
    let dataOffset: UInt64
    let endOffset: UInt64
}

protocol ExtractionEngine: Sendable {
    func extract(
        request: ExtractionRequest,
        outputURL: URL,
        isCancelled: @escaping @Sendable () -> Bool
    ) throws -> ExtractionMetadata
}

final class SubtitleExtractor: ExtractionEngine, @unchecked Sendable {
    func extract(
        request: ExtractionRequest,
        outputURL: URL,
        isCancelled: @escaping @Sendable () -> Bool
    ) throws -> ExtractionMetadata {
        try validateInput(request)
        av_log_set_level(AV_LOG_QUIET)
        var formatContext: UnsafeMutablePointer<AVFormatContext>?
        guard avformat_open_input(&formatContext, request.mediaURL.path, nil, nil) >= 0,
              let formatContext
        else { throw ExtractorError.emptyOrUnreadable }
        defer {
            var context: UnsafeMutablePointer<AVFormatContext>? = formatContext
            avformat_close_input(&context)
        }
        guard avformat_find_stream_info(formatContext, nil) >= 0,
              request.stream.ffIndex < Int(formatContext.pointee.nb_streams),
              let stream = formatContext.pointee.streams[request.stream.ffIndex]
        else { throw ExtractorError.trackIdentityMismatch }
        let parameters = stream.pointee.codecpar.pointee
        let needsMatroskaFormat = request.mediaURL.pathExtension.lowercased() == "mkv" &&
            [.ass, .ssa].contains(request.stream.codec)
        guard parameters.codec_type == AVMEDIA_TYPE_SUBTITLE,
              codecMatches(parameters.codec_id, request.stream.codec),
              request.stream.sourceID == nil || needsMatroskaFormat ||
                request.stream.sourceID == Int(stream.pointee.id)
        else { throw ExtractorError.trackIdentityMismatch }
        var sourceFormat: EmbeddedSubtitleCodec?
        if needsMatroskaFormat, let sourceID = request.stream.sourceID {
            guard let extra = parameters.extradata, parameters.extradata_size > 0
            else { throw ExtractorError.trackIdentityMismatch }
            sourceFormat = try matroskaSubtitleFormat(
                request.mediaURL,
                trackNumber: sourceID,
                codecPrivate: Data(bytes: extra, count: Int(parameters.extradata_size))
            )
        }
        guard let decoder = avcodec_find_decoder(parameters.codec_id),
              let codecContext = avcodec_alloc_context3(decoder)
        else { throw ExtractorError.unsupportedCodec }
        defer {
            var context: UnsafeMutablePointer<AVCodecContext>? = codecContext
            avcodec_free_context(&context)
        }
        guard avcodec_parameters_to_context(codecContext, stream.pointee.codecpar) >= 0,
              avcodec_open2(codecContext, decoder, nil) >= 0
        else { throw ExtractorError.extractionFailed }
        guard let packet = av_packet_alloc() else { throw ExtractorError.extractionFailed }
        defer {
            var value: UnsafeMutablePointer<AVPacket>? = packet
            av_packet_free(&value)
        }
        var cues: [SubtitleCue] = []
        var order = 0
        while av_read_frame(formatContext, packet) >= 0 {
            if isCancelled() || Task.isCancelled { throw ExtractorError.cancelled }
            defer { av_packet_unref(packet) }
            if packet.pointee.stream_index != Int32(request.stream.ffIndex) { continue }
            var subtitle = AVSubtitle()
            var received: Int32 = 0
            let decoded = avcodec_decode_subtitle2(codecContext, &subtitle, &received, packet)
            defer { avsubtitle_free(&subtitle) }
            if decoded < 0 { throw ExtractorError.emptyOrUnreadable }
            if received == 0 { continue }
            let baseMilliseconds: Int64
            if subtitle.pts != Int64.min {
                baseMilliseconds = subtitle.pts / 1_000
            } else if packet.pointee.pts != Int64.min {
                baseMilliseconds = av_rescale_q(
                    packet.pointee.pts,
                    stream.pointee.time_base,
                    AVRational(num: 1, den: 1_000)
                )
            } else {
                continue
            }
            let start = baseMilliseconds + Int64(subtitle.start_display_time)
            let packetDuration = av_rescale_q(
                packet.pointee.duration,
                stream.pointee.time_base,
                AVRational(num: 1, den: 1_000)
            )
            let end = subtitle.end_display_time > subtitle.start_display_time
                ? baseMilliseconds + Int64(subtitle.end_display_time)
                : start + packetDuration
            guard end > start else { continue }
            for index in 0..<Int(subtitle.num_rects) {
                guard let rect = subtitle.rects[index], let text = normalizedText(rect.pointee)
                else { continue }
                cues.append(
                    SubtitleCue(
                        startMilliseconds: start,
                        endMilliseconds: end,
                        text: text,
                        order: order
                    )
                )
                order += 1
                if cues.count > request.maxCueCount { throw ExtractorError.outputLimit }
            }
        }
        guard !cues.isEmpty else { throw ExtractorError.emptyOrUnreadable }
        cues.sort {
            ($0.startMilliseconds, $0.endMilliseconds, $0.order) <
                ($1.startMilliseconds, $1.endMilliseconds, $1.order)
        }
        let rendered = render(cues)
        let data = Data(rendered.utf8)
        guard data.count <= request.maxOutputBytes else { throw ExtractorError.outputLimit }
        do {
            try data.write(to: outputURL, options: [.atomic])
            try FileManager.default.setAttributes(
                [.posixPermissions: 0o600],
                ofItemAtPath: outputURL.path
            )
        } catch {
            throw ExtractorError.extractionFailed
        }
        let digest = SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
        return ExtractionMetadata(
            cueCount: cues.count,
            byteCount: data.count,
            sha256: digest,
            sourceFormat: sourceFormat
        )
    }

    private func matroskaSubtitleFormat(
        _ url: URL,
        trackNumber: Int,
        codecPrivate: Data
    ) throws -> EmbeddedSubtitleCodec {
        guard trackNumber > 0,
              let fileSize = (try FileManager.default.attributesOfItem(atPath: url.path)[.size] as? NSNumber)?.uint64Value,
              fileSize > 0
        else { throw ExtractorError.trackIdentityMismatch }
        let handle = try FileHandle(forReadingFrom: url)
        defer { try? handle.close() }
        guard let segment = try findMatroskaElement(0x18538067, in: 0..<fileSize, handle: handle),
              let tracks = try findMatroskaElement(
                0x1654AE6B,
                in: segment.dataOffset..<segment.endOffset,
                handle: handle
              )
        else { throw ExtractorError.trackIdentityMismatch }
        var offset = tracks.dataOffset
        var matched: EmbeddedSubtitleCodec?
        var matches = 0
        var matchingTrackNumbers = 0
        while offset < tracks.endOffset {
            let entry = try matroskaElement(at: offset, within: tracks.endOffset, handle: handle)
            if entry.id == 0xAE,
               let candidate = try matroskaTrackData(entry, handle: handle) {
                if candidate.number == UInt64(trackNumber) { matchingTrackNumbers += 1 }
                if candidate.codecPrivate == codecPrivate {
                    matches += 1
                    guard candidate.number == UInt64(trackNumber),
                          candidate.type == 0x11
                    else { throw ExtractorError.trackIdentityMismatch }
                    switch candidate.codecID {
                    case "S_TEXT/SSA", "S_SSA": matched = .ssa
                    case "S_TEXT/ASS", "S_ASS": matched = .ass
                    default: throw ExtractorError.trackIdentityMismatch
                    }
                }
            }
            offset = entry.endOffset
        }
        guard matches == 1, matchingTrackNumbers == 1, let matched
        else { throw ExtractorError.trackIdentityMismatch }
        return matched
    }

    private func matroskaTrackData(
        _ entry: MatroskaElement,
        handle: FileHandle
    ) throws -> (number: UInt64, type: UInt64, codecID: String, codecPrivate: Data)? {
        var offset = entry.dataOffset
        var trackNumber: UInt64?
        var trackType: UInt64?
        var codecID: String?
        var codecPrivate: Data?
        while offset < entry.endOffset {
            let element = try matroskaElement(at: offset, within: entry.endOffset, handle: handle)
            let length = element.endOffset - element.dataOffset
            if element.id == 0xD7 || element.id == 0x83 {
                guard length > 0, length <= 8 else { throw ExtractorError.trackIdentityMismatch }
                let bytes = try matroskaBytes(handle, at: element.dataOffset, count: Int(length))
                let value = bytes.reduce(UInt64(0)) { ($0 << 8) | UInt64($1) }
                if element.id == 0xD7 {
                    guard trackNumber == nil else { throw ExtractorError.trackIdentityMismatch }
                    trackNumber = value
                } else {
                    guard trackType == nil else { throw ExtractorError.trackIdentityMismatch }
                    trackType = value
                }
            } else if element.id == 0x86 {
                guard codecID == nil, length > 0, length <= 64,
                      let value = String(
                        data: try matroskaBytes(handle, at: element.dataOffset, count: Int(length)),
                        encoding: .utf8
                      )
                else { throw ExtractorError.trackIdentityMismatch }
                codecID = value
            } else if element.id == 0x63A2 {
                guard codecPrivate == nil, length > 0, length <= 1_048_576
                else { throw ExtractorError.trackIdentityMismatch }
                codecPrivate = try matroskaBytes(handle, at: element.dataOffset, count: Int(length))
            }
            offset = element.endOffset
        }
        guard let trackNumber, let trackType, let codecID, let codecPrivate else { return nil }
        return (trackNumber, trackType, codecID, codecPrivate)
    }

    private func findMatroskaElement(
        _ id: UInt64,
        in range: Range<UInt64>,
        handle: FileHandle
    ) throws -> MatroskaElement? {
        var offset = range.lowerBound
        while offset < range.upperBound {
            let element = try matroskaElement(at: offset, within: range.upperBound, handle: handle)
            if element.id == id { return element }
            offset = element.endOffset
        }
        return nil
    }

    private func matroskaElement(
        at offset: UInt64,
        within end: UInt64,
        handle: FileHandle
    ) throws -> MatroskaElement {
        guard offset < end else { throw ExtractorError.trackIdentityMismatch }
        let firstID = try matroskaBytes(handle, at: offset, count: 1)[0]
        let idWidth = firstID.leadingZeroBitCount + 1
        guard idWidth <= 4, UInt64(idWidth) <= end - offset
        else { throw ExtractorError.trackIdentityMismatch }
        let idBytes = try matroskaBytes(handle, at: offset, count: idWidth)
        let id = idBytes.reduce(UInt64(0)) { ($0 << 8) | UInt64($1) }
        let sizeOffset = offset + UInt64(idWidth)
        guard sizeOffset < end else { throw ExtractorError.trackIdentityMismatch }
        let firstSize = try matroskaBytes(handle, at: sizeOffset, count: 1)[0]
        let sizeWidth = firstSize.leadingZeroBitCount + 1
        guard sizeWidth <= 8, UInt64(sizeWidth) <= end - sizeOffset
        else { throw ExtractorError.trackIdentityMismatch }
        let sizeBytes = try matroskaBytes(handle, at: sizeOffset, count: sizeWidth)
        let size = sizeBytes.dropFirst().reduce(UInt64(firstSize & (0xff >> sizeWidth))) {
            ($0 << 8) | UInt64($1)
        }
        let dataOffset = sizeOffset + UInt64(sizeWidth)
        let unknownSize = (UInt64(1) << (7 * sizeWidth)) - 1
        if size == unknownSize, id == 0x18538067 {
            return MatroskaElement(id: id, dataOffset: dataOffset, endOffset: end)
        }
        guard size != unknownSize, size <= end - dataOffset
        else { throw ExtractorError.trackIdentityMismatch }
        return MatroskaElement(id: id, dataOffset: dataOffset, endOffset: dataOffset + size)
    }

    private func matroskaBytes(_ handle: FileHandle, at offset: UInt64, count: Int) throws -> Data {
        try handle.seek(toOffset: offset)
        guard let data = try handle.read(upToCount: count), data.count == count
        else { throw ExtractorError.trackIdentityMismatch }
        return data
    }

    private func validateInput(_ request: ExtractionRequest) throws {
        guard request.mediaURL.isFileURL,
              request.mediaURL.path.hasPrefix("/"),
              request.maxCueCount == ProtocolLimits.maxCueCount,
              request.maxOutputBytes == ProtocolLimits.maxOutputBytes
        else { throw ExtractorError.invalidRequest }
        let attributes: [FileAttributeKey: Any]
        do {
            attributes = try FileManager.default.attributesOfItem(atPath: request.mediaURL.path)
        } catch {
            throw ExtractorError.emptyOrUnreadable
        }
        guard attributes[.type] as? FileAttributeType == .typeRegular
        else { throw ExtractorError.invalidRequest }
        let extensionName = request.mediaURL.pathExtension.lowercased()
        let supported =
            (["mkv"].contains(extensionName) && [.subrip, .ass, .ssa].contains(request.stream.codec)) ||
            (["mov", "mp4", "m4v"].contains(extensionName) && request.stream.codec == .movText)
        guard supported else { throw ExtractorError.unsupportedCodec }
    }

    private func codecMatches(_ codecID: AVCodecID, _ codec: EmbeddedSubtitleCodec) -> Bool {
        switch codec {
        case .subrip:
            return codecID == AV_CODEC_ID_SUBRIP
        case .ass, .ssa:
            return codecID == AV_CODEC_ID_ASS
        case .movText:
            return codecID == AV_CODEC_ID_MOV_TEXT
        }
    }

    private func normalizedText(_ rect: AVSubtitleRect) -> String? {
        let source: String
        if let text = rect.text {
            source = String(cString: text)
        } else if let ass = rect.ass {
            let value = String(cString: ass)
            source = value.split(separator: ",", maxSplits: 8, omittingEmptySubsequences: false).last.map(String.init) ?? value
        } else {
            return nil
        }
        let withoutTags = source.replacingOccurrences(
            of: #"\{[^}]*\}"#,
            with: "",
            options: .regularExpression
        )
        let normalized = withoutTags
            .replacingOccurrences(of: #"\N"#, with: "\n")
            .replacingOccurrences(of: #"\n"#, with: "\n")
            .replacingOccurrences(of: #"\h"#, with: " ")
            .replacingOccurrences(of: "\r\n", with: "\n")
            .replacingOccurrences(of: "\r", with: "\n")
            .trimmingCharacters(in: .whitespacesAndNewlines)
        return normalized.isEmpty ? nil : normalized
    }

    private func render(_ cues: [SubtitleCue]) -> String {
        cues.enumerated().map { index, cue in
            "\(index + 1)\n\(timestamp(cue.startMilliseconds)) --> \(timestamp(cue.endMilliseconds))\n\(cue.text)"
        }.joined(separator: "\n\n") + "\n"
    }

    private func timestamp(_ milliseconds: Int64) -> String {
        let safe = max(0, milliseconds)
        let hours = safe / 3_600_000
        let minutes = (safe / 60_000) % 60
        let seconds = (safe / 1_000) % 60
        let fraction = safe % 1_000
        return String(format: "%02lld:%02lld:%02lld,%03lld", hours, minutes, seconds, fraction)
    }
}
