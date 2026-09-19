import Darwin
import Foundation

private actor FileRPCConcurrencyProbe {
    private var active = 0
    private var maximum = 0
    private var handled = 0

    func begin() {
        active += 1
        handled += 1
        maximum = max(maximum, active)
    }

    func end() {
        active -= 1
    }

    func snapshot() -> (Int, Int) {
        (maximum, handled)
    }
}

func runFileRPCClientTests() async throws {
    let root = FileManager.default.temporaryDirectory
        .appendingPathComponent("subtandem-file-rpc-\(UUID().uuidString)", isDirectory: true)
    let rpcDirectory = root.appendingPathComponent(".rpc", isDirectory: true)
    let credentialDirectory = root.appendingPathComponent("credentials", isDirectory: true)
    defer { try? FileManager.default.removeItem(at: root) }
    try FileRPCWorker.prepareDirectory(rpcDirectory)
    let credentialStore = try SecureCredentialStore(directory: credentialDirectory)
    let liveness = LivenessState(parentPID: getpid())
    let server = try TransportServer(
        token: "correct-token",
        liveness: liveness,
        credentialStore: credentialStore
    )
    let port = try await server.start()
    defer { server.stop() }
    let worker = Task {
        await FileRPCWorker.run(directory: rpcDirectory, port: port) { path, token, body in
            await server.handleFileRequest(path: path, token: token, body: body)
        }
    }
    defer { worker.cancel() }

    let createdAt = String(Int64(Date().timeIntervalSince1970 * 1_000), radix: 36)
    let stem = "transport-\(createdAt)-1-test"
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
    let directoryMode = try FileManager.default.attributesOfItem(
        atPath: rpcDirectory.path
    )[.posixPermissions] as? NSNumber
    let responseMode = try FileManager.default.attributesOfItem(
        atPath: responseFile.path
    )[.posixPermissions] as? NSNumber
    try check(directoryMode?.intValue == 0o700, "RPC directory must use mode 0700")
    try check(responseMode?.intValue == 0o600, "RPC response must use mode 0600")
    let response = try JSONSerialization.jsonObject(with: Data(contentsOf: responseFile)) as? [String: Any]
    let body = response?["body"] as? [String: Any]
    try check(response?["type"] as? String == "response", "RPC response must use the strict frame")
    try check(response?["protocolVersion"] as? Int == 1, "RPC response version must be one")
    try check(response?["statusCode"] as? Int == 200, "RPC health must preserve status")
    try check(body?["state"] as? String == "ok", "RPC health must preserve its body")
    let responseEntries = try FileManager.default.contentsOfDirectory(
        at: rpcDirectory,
        includingPropertiesForKeys: nil
    )
    try check(
        responseEntries.allSatisfy { $0.pathExtension != "tmp" },
        "RPC response publication must remove its temporary file"
    )

    let unauthorizedStem = "transport-\(createdAt)-2-test"
    let unauthorizedRequest = rpcDirectory.appendingPathComponent("\(unauthorizedStem).request.json")
    let unauthorizedResponse = rpcDirectory.appendingPathComponent("\(unauthorizedStem).response.json")
    var unauthorizedFrame = request
    unauthorizedFrame["token"] = "wrong-token"
    unauthorizedFrame["createdAtMs"] = Int64(Date().timeIntervalSince1970 * 1_000)
    try JSONSerialization.data(withJSONObject: unauthorizedFrame).write(to: unauthorizedRequest)
    try Data().write(to: rpcDirectory.appendingPathComponent("\(unauthorizedStem).request.ready"))
    try await waitForFile(unauthorizedResponse)
    let unauthorized = try JSONSerialization.jsonObject(
        with: Data(contentsOf: unauthorizedResponse)
    ) as? [String: Any]
    let unauthorizedBody = unauthorized?["body"] as? [String: Any]
    try check(unauthorized?["statusCode"] as? Int == 401, "RPC client must preserve auth failure")
    try check(unauthorizedBody?["error"] as? String == "unauthorized", "auth failure must stay fixed")

    var unexpected = request
    unexpected["secretCopy"] = "private"
    try expectFailure("RPC request must reject extra fields") {
        _ = try FileRPCWorker.decodeRequest(
            JSONSerialization.data(withJSONObject: unexpected)
        )
    }
    var expired = request
    expired["createdAtMs"] = 1
    try expectFailure("RPC request must reject expired files") {
        _ = try FileRPCWorker.decodeRequest(
            JSONSerialization.data(withJSONObject: expired),
            nowMs: 100_000
        )
    }

    let symlinkStem = "transport-\(createdAt)-3-test"
    let symlinkTarget = root.appendingPathComponent("symlink-target.json")
    let symlinkRequest = rpcDirectory.appendingPathComponent("\(symlinkStem).request.json")
    let symlinkMarker = rpcDirectory.appendingPathComponent("\(symlinkStem).request.ready")
    let symlinkResponse = rpcDirectory.appendingPathComponent("\(symlinkStem).response.json")
    try JSONSerialization.data(withJSONObject: request).write(to: symlinkTarget)
    guard symlink(symlinkTarget.path, symlinkRequest.path) == 0 else {
        throw ContractTestFailure(description: "failed to create RPC symlink fixture")
    }
    try Data().write(to: symlinkMarker)
    try await waitForRemoval(symlinkMarker)
    try check(
        FileManager.default.fileExists(atPath: symlinkTarget.path),
        "RPC worker must not follow request symlinks"
    )
    try check(
        !FileManager.default.fileExists(atPath: symlinkResponse.path),
        "rejected RPC symlinks must not publish a response"
    )

    let concurrencyDirectory = root.appendingPathComponent("concurrency", isDirectory: true)
    try FileRPCWorker.prepareDirectory(concurrencyDirectory)
    let concurrencyPort: UInt16 = 49_153
    let probe = FileRPCConcurrencyProbe()
    let concurrencyWorker = Task {
        await FileRPCWorker.run(
            directory: concurrencyDirectory,
            port: concurrencyPort,
            maximumConcurrentRequests: 3
        ) { _, _, _ in
            await probe.begin()
            try? await Task.sleep(for: .milliseconds(30))
            await probe.end()
            return .json(statusCode: 200, ["state": "ok"])
        }
    }
    defer { concurrencyWorker.cancel() }
    var concurrencyResponses: [URL] = []
    for index in 0..<12 {
        let concurrentStem = "transport-\(createdAt)-\(String(index + 10, radix: 36))-test"
        let concurrentRequest = concurrencyDirectory
            .appendingPathComponent("\(concurrentStem).request.json")
        let concurrentMarker = concurrencyDirectory
            .appendingPathComponent("\(concurrentStem).request.ready")
        let concurrentResponse = concurrencyDirectory
            .appendingPathComponent("\(concurrentStem).response.json")
        var concurrentFrame = request
        concurrentFrame["port"] = Int(concurrencyPort)
        concurrentFrame["createdAtMs"] = Int64(Date().timeIntervalSince1970 * 1_000)
        try JSONSerialization.data(withJSONObject: concurrentFrame).write(to: concurrentRequest)
        try Data().write(to: concurrentMarker)
        concurrencyResponses.append(concurrentResponse)
    }
    for response in concurrencyResponses {
        try await waitForFile(response)
    }
    let concurrency = await probe.snapshot()
    try check(concurrency.0 == 3, "RPC worker must enforce its native concurrency ceiling")
    try check(concurrency.1 == 12, "RPC worker must claim each request exactly once")
}

private func waitForFile(_ file: URL) async throws {
    for _ in 0..<250 {
        if FileManager.default.fileExists(atPath: file.path) { return }
        try await Task.sleep(for: .milliseconds(20))
    }
    throw ContractTestFailure(description: "file RPC response timed out")
}

private func waitForRemoval(_ file: URL) async throws {
    for _ in 0..<250 {
        if !FileManager.default.fileExists(atPath: file.path) { return }
        try await Task.sleep(for: .milliseconds(20))
    }
    throw ContractTestFailure(description: "file RPC claim timed out")
}
