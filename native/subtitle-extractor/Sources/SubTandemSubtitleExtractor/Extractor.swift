import CFFmpeg
import CryptoKit
import Foundation

struct SubtitleCue: Sendable, Equatable {
    let startMilliseconds: Int64
    let endMilliseconds: Int64
    let text: String
    let order: Int
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
        guard parameters.codec_type == AVMEDIA_TYPE_SUBTITLE,
              codecMatches(parameters.codec_id, request.stream.codec),
              request.stream.sourceID == nil || request.stream.sourceID == Int(stream.pointee.id)
        else { throw ExtractorError.trackIdentityMismatch }
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
        return ExtractionMetadata(cueCount: cues.count, byteCount: data.count, sha256: digest)
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
