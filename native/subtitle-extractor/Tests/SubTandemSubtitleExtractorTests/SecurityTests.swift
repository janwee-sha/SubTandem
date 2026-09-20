import Darwin
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

    let readyRoot = FileManager.default.temporaryDirectory
        .appendingPathComponent("subtandem-extractor-ready-\(UUID().uuidString)", isDirectory: true)
    let readyFile = readyRoot
        .appendingPathComponent(".ready", isDirectory: true)
        .appendingPathComponent("extractor-test.json")
    defer { try? FileManager.default.removeItem(at: readyRoot) }
    try ReadyFileWriter.write(
        ReadyFrame(port: 49152, token: "opaque-token", createdAtMs: 10_000),
        to: readyFile
    )
    let readyDirectoryMode = try permissions(readyFile.deletingLastPathComponent())
    let readyFileMode = try permissions(readyFile)
    try check(readyDirectoryMode == 0o700, "ready directory must use mode 0700")
    try check(readyFileMode == 0o600, "ready file must use mode 0600")
    let readyText = try String(contentsOf: readyFile, encoding: .utf8)
    try check(readyText.contains("\"createdAtMs\":10000"), "ready frame must include its freshness timestamp")
    try expectError(.extractionFailed) {
        try ReadyFileWriter.write(
            ReadyFrame(port: 49153, token: "other-token", createdAtMs: 20_000),
            to: readyFile
        )
    }
    let readyEntries = try FileManager.default.contentsOfDirectory(
        at: readyFile.deletingLastPathComponent(),
        includingPropertiesForKeys: nil
    )
    try check(
        readyEntries.allSatisfy { $0.pathExtension != "tmp" },
        "atomic publication must remove its temporary file"
    )

    let rpcDirectory = root.appendingPathComponent(".rpc", isDirectory: true)
    try FileRPCWorker.prepareDirectory(rpcDirectory)
    let liveness = LivenessState(parentPID: getpid())
    let server = try SubtitleExtractorServer(token: "correct-token", jobs: jobs, liveness: liveness)
    let port = try await server.start()
    defer { server.stop() }
    let worker = Task {
        await FileRPCWorker.run(directory: rpcDirectory, port: port) { path, token, body in
            await server.handleFileRequest(path: path, token: token, body: body)
        }
    }
    defer { worker.cancel() }
    let rpcCreatedAt = String(Int64(Date().timeIntervalSince1970 * 1_000), radix: 36)
    let stem = "extractor-\(rpcCreatedAt)-1-test"
    let requestFile = rpcDirectory.appendingPathComponent("\(stem).request.json")
    let responseFile = rpcDirectory.appendingPathComponent("\(stem).response.json")
    let request: [String: Any] = [
        "type": "request",
        "protocolVersion": 1,
        "createdAtMs": Int64(Date().timeIntervalSince1970 * 1_000),
        "port": Int(port),
        "token": "correct-token",
        "path": "/v1/health",
        "body": [:],
    ]
    try JSONSerialization.data(withJSONObject: request).write(to: requestFile)
    try FileManager.default.setAttributes(
        [.posixPermissions: 0o644],
        ofItemAtPath: requestFile.path
    )
    try Data().write(to: rpcDirectory.appendingPathComponent("\(stem).request.ready"))
    try await waitForFile(responseFile)
    try check(!FileManager.default.fileExists(atPath: requestFile.path), "RPC request must be removed")
    let rpcDirectoryMode = try permissions(rpcDirectory)
    let responseMode = try permissions(responseFile)
    try check(rpcDirectoryMode == 0o700, "RPC directory must use mode 0700")
    try check(responseMode == 0o600, "RPC response must use mode 0600")
    let rpcResponse = try JSONSerialization.jsonObject(
        with: Data(contentsOf: responseFile)
    ) as? [String: Any]
    let rpcBody = rpcResponse?["body"] as? [String: Any]
    try check(rpcResponse?["statusCode"] as? Int == 200, "RPC health must preserve status")
    try check(rpcBody?["state"] as? String == "ok", "RPC health must preserve its body")
    var unexpected = request
    unexpected["secretCopy"] = "private"
    try expectError(.invalidRequest) {
        do {
            _ = try FileRPCWorker.decodeRequest(JSONSerialization.data(withJSONObject: unexpected))
        } catch {
            throw ExtractorError.invalidRequest
        }
    }
}

private func waitForFile(_ file: URL) async throws {
    for _ in 0..<250 {
        if FileManager.default.fileExists(atPath: file.path) { return }
        try await Task.sleep(for: .milliseconds(20))
    }
    throw SubtitleExtractorTestFailure(description: "file RPC response timed out")
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
