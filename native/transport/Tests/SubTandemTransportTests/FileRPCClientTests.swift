import Darwin
import Foundation

func runFileRPCClientTests() async throws {
    let root = FileManager.default.temporaryDirectory
        .appendingPathComponent("subtandem-file-rpc-\(UUID().uuidString)", isDirectory: true)
    let rpcDirectory = root.appendingPathComponent(".rpc", isDirectory: true)
    let credentialDirectory = root.appendingPathComponent("credentials", isDirectory: true)
    defer { try? FileManager.default.removeItem(at: root) }
    try FileRPCClient.prepareDirectory(rpcDirectory)
    let credentialStore = try SecureCredentialStore(directory: credentialDirectory)
    let liveness = LivenessState(parentPID: getpid())
    let server = try TransportServer(
        token: "correct-token",
        liveness: liveness,
        credentialStore: credentialStore
    )
    let port = try await server.start()
    defer { server.stop() }

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
    try await FileRPCClient.run(arguments: [
        "subtandem-transport",
        "--rpc-client",
        "--rpc-directory", rpcDirectory.path,
        "--request-file", requestFile.path,
        "--response-file", responseFile.path,
    ])
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
    try await FileRPCClient.run(arguments: [
        "subtandem-transport",
        "--rpc-client",
        "--rpc-directory", rpcDirectory.path,
        "--request-file", unauthorizedRequest.path,
        "--response-file", unauthorizedResponse.path,
    ])
    let unauthorized = try JSONSerialization.jsonObject(
        with: Data(contentsOf: unauthorizedResponse)
    ) as? [String: Any]
    let unauthorizedBody = unauthorized?["body"] as? [String: Any]
    try check(unauthorized?["statusCode"] as? Int == 401, "RPC client must preserve auth failure")
    try check(unauthorizedBody?["error"] as? String == "unauthorized", "auth failure must stay fixed")

    var unexpected = request
    unexpected["secretCopy"] = "private"
    try expectFailure("RPC request must reject extra fields") {
        _ = try FileRPCClient.decodeRequest(
            JSONSerialization.data(withJSONObject: unexpected)
        )
    }
    var expired = request
    expired["createdAtMs"] = 1
    try expectFailure("RPC request must reject expired files") {
        _ = try FileRPCClient.decodeRequest(
            JSONSerialization.data(withJSONObject: expired),
            nowMs: 100_000
        )
    }
}
