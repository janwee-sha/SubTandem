import Foundation

private let expectedText = "1\n00:00:01,000 --> 00:00:02,000\nFirst line\n\n2\n00:00:03,250 --> 00:00:04,500\nSecond line\n"

func runExtractionTests() throws {
    for fixture in [
        ("matroska-subrip.mkv", EmbeddedSubtitleCodec.subrip),
        ("matroska-ass.mkv", EmbeddedSubtitleCodec.ass),
        ("matroska-ssa.mkv", EmbeddedSubtitleCodec.ssa),
        ("mov-text.mp4", EmbeddedSubtitleCodec.movText),
    ] {
        let output = FileManager.default.temporaryDirectory
            .appendingPathComponent(UUID().uuidString)
            .appendingPathExtension("srt")
        defer { try? FileManager.default.removeItem(at: output) }
        let metadata: ExtractionMetadata
        do {
            metadata = try SubtitleExtractor().extract(
                request: ExtractionRequest(
                    mediaURL: fixtureURL(fixture.0),
                    stream: StreamIdentity(ffIndex: 0, sourceID: nil, codec: fixture.1),
                    maxCueCount: 20_000,
                    maxOutputBytes: 16_777_216
                ),
                outputURL: output,
                isCancelled: { false }
            )
        } catch {
            throw SubtitleExtractorTestFailure(description: "\(fixture.0) extraction failed with \(error)")
        }
        let text = try String(contentsOf: output, encoding: .utf8)
        try check(text == expectedText, "\(fixture.0) must normalize to exact UTF-8 SRT")
        try check(metadata.cueCount == 2, "\(fixture.0) must retain cue count")
        try check(metadata.byteCount == Data(expectedText.utf8).count, "\(fixture.0) byte count must match")
        try check(metadata.sha256.count == 64, "\(fixture.0) hash must be SHA-256")
    }
    let output = FileManager.default.temporaryDirectory
        .appendingPathComponent(UUID().uuidString)
        .appendingPathExtension("srt")
    do {
        _ = try SubtitleExtractor().extract(
            request: ExtractionRequest(
                mediaURL: fixtureURL("matroska-subrip.mkv"),
                stream: StreamIdentity(ffIndex: 1, sourceID: nil, codec: .subrip),
                maxCueCount: 20_000,
                maxOutputBytes: 16_777_216
            ),
            outputURL: output,
            isCancelled: { false }
        )
        throw SubtitleExtractorTestFailure(description: "mismatched stream must be rejected")
    } catch {
        try check(error as? ExtractorError == .trackIdentityMismatch, "mismatched stream must use safe identity error")
    }
}

private func fixtureURL(_ name: String) -> URL {
    URL(fileURLWithPath: #filePath)
        .deletingLastPathComponent()
        .deletingLastPathComponent()
        .deletingLastPathComponent()
        .deletingLastPathComponent()
        .deletingLastPathComponent()
        .appendingPathComponent("tests/fixtures/media/generated")
        .appendingPathComponent(name)
}
