import Foundation

func runSecurityTests() async throws {
    let unknown = Data(
        #"{"jobId":"7a90a4e6-cc4f-4f59-99b7-8ff522f887ae","mediaPath":"/private/media.mkv","stream":{"ffIndex":0,"sourceId":null,"codec":"ass"},"deadlineMs":15000,"maxCueCount":20000,"maxOutputBytes":16777216,"path":"private"}"#.utf8
    )
    try expectError(.invalidRequest) { _ = try ProtocolDecoder.prepare(unknown) }

    let graphic = Data(
        #"{"jobId":"7a90a4e6-cc4f-4f59-99b7-8ff522f887ae","mediaPath":"/private/media.mkv","stream":{"ffIndex":0,"sourceId":null,"codec":"hdmv_pgs_subtitle"},"deadlineMs":15000,"maxCueCount":20000,"maxOutputBytes":16777216}"#.utf8
    )
    try expectError(.invalidRequest) { _ = try ProtocolDecoder.prepare(graphic) }

    let alteredLimits = Data(
        #"{"jobId":"7a90a4e6-cc4f-4f59-99b7-8ff522f887ae","mediaPath":"/private/media.mkv","stream":{"ffIndex":0,"sourceId":null,"codec":"ass"},"deadlineMs":15000,"maxCueCount":20001,"maxOutputBytes":16777217}"#.utf8
    )
    try expectError(.invalidRequest) { _ = try ProtocolDecoder.prepare(alteredLimits) }

    let extractor = SubtitleExtractor()
    let output = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
    for mediaURL in [
        URL(string: "https://example.test/media.mkv")!,
        URL(fileURLWithPath: "/dev/null"),
        URL(fileURLWithPath: "/dev/stdin"),
    ] {
        try expectError(.invalidRequest) {
            _ = try extractor.extract(
                request: ExtractionRequest(
                    mediaURL: mediaURL,
                    stream: StreamIdentity(ffIndex: 0, sourceID: nil, codec: .subrip),
                    maxCueCount: ProtocolLimits.maxCueCount,
                    maxOutputBytes: ProtocolLimits.maxOutputBytes
                ),
                outputURL: output,
                isCancelled: { false }
            )
        }
    }

    try expectError(.trackIdentityMismatch) {
        _ = try extractor.extract(
            request: ExtractionRequest(
                mediaURL: securityFixtureURL("matroska-subrip.mkv"),
                stream: StreamIdentity(ffIndex: 0, sourceID: 999, codec: .subrip),
                maxCueCount: ProtocolLimits.maxCueCount,
                maxOutputBytes: ProtocolLimits.maxOutputBytes
            ),
            outputURL: output,
            isCancelled: { false }
        )
    }

    let root = FileManager.default.temporaryDirectory
        .appendingPathComponent("subtandem-security-\(UUID().uuidString)", isDirectory: true)
    let jobs = try ExtractionJobs(rootURL: root)
    defer { try? FileManager.default.removeItem(at: root) }
    let rootMode = try permissions(root)
    try check(rootMode == 0o700, "extraction root must use mode 0700")
    let result = try await jobs.prepare(
        PrepareRequest(
            jobID: UUID(),
            mediaPath: securityFixtureURL("matroska-subrip.mkv").path,
            stream: StreamIdentity(ffIndex: 0, sourceID: nil, codec: .subrip),
            deadlineMilliseconds: ProtocolLimits.deadlineMilliseconds,
            maxCueCount: ProtocolLimits.maxCueCount,
            maxOutputBytes: ProtocolLimits.maxOutputBytes
        )
    )
    let resultDirectory = root.appendingPathComponent(result.resultID.uuidString.lowercased())
    let resultMode = try permissions(resultDirectory)
    let outputMode = try permissions(resultDirectory.appendingPathComponent("output.srt"))
    try check(resultMode == 0o700, "result directory must use mode 0700")
    try check(
        outputMode == 0o600,
        "result file must use mode 0600"
    )
    try jobs.release(result.resultID)

    let response = ProtocolResponse.error(.extractionFailed)
    try check(
        String(decoding: response.body, as: UTF8.self) == #"{"error":"EXTRACTION_FAILED"}"#,
        "protocol errors must expose only fixed codes"
    )
}

private func expectError(_ expected: ExtractorError, _ operation: () throws -> Void) throws {
    do {
        try operation()
        throw SubtitleExtractorTestFailure(description: "expected \(expected.rawValue)")
    } catch let error as ExtractorError {
        try check(error == expected, "unexpected extractor error")
    }
}

private func permissions(_ url: URL) throws -> Int {
    let attributes = try FileManager.default.attributesOfItem(atPath: url.path)
    guard let value = attributes[.posixPermissions] as? NSNumber
    else { throw SubtitleExtractorTestFailure(description: "missing permissions") }
    return value.intValue
}

private func securityFixtureURL(_ name: String) -> URL {
    URL(fileURLWithPath: #filePath)
        .deletingLastPathComponent()
        .deletingLastPathComponent()
        .deletingLastPathComponent()
        .deletingLastPathComponent()
        .deletingLastPathComponent()
        .appendingPathComponent("tests/fixtures/media/generated")
        .appendingPathComponent(name)
}
