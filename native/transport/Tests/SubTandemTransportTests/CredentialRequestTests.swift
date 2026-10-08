import Foundation
import Network

final class CredentialCaptureServer: @unchecked Sendable {
    private let listener: NWListener
    private let queue = DispatchQueue(label: "io.subtandem.credential-request-tests")
    private let lock = NSLock()
    private var captured: [String] = []
    private var response: Data = Data("HTTP/1.1 200 OK\r\nContent-Length: 2\r\nConnection: close\r\n\r\n{}".utf8)
    private var connections: [NWConnection] = []
    private var delay: UInt64 = 0

    init() throws {
        let parameters = NWParameters.tcp
        parameters.requiredLocalEndpoint = .hostPort(host: "127.0.0.1", port: .any)
        listener = try NWListener(using: parameters)
    }

    func start() async throws -> UInt16 {
        try await withCheckedThrowingContinuation { continuation in
            listener.stateUpdateHandler = { [weak self] state in
                guard let self else { return }
                if case .ready = state { continuation.resume(returning: self.listener.port!.rawValue) }
                if case .failed(let error) = state { continuation.resume(throwing: error) }
            }
            listener.newConnectionHandler = { [weak self] connection in
                guard let self else { return }
                self.lock.withLock { self.connections.append(connection) }
                connection.start(queue: self.queue)
                self.receive(connection, data: Data())
            }
            listener.start(queue: queue)
        }
    }

    private func receive(_ connection: NWConnection, data: Data) {
        connection.receive(minimumIncompleteLength: 1, maximumLength: 65536) { [weak self] bytes, _, complete, error in
            guard let self else { return }
            let combined = data + (bytes ?? Data())
            if combined.range(of: Data("\r\n\r\n".utf8)) != nil {
                let (output, delay) = self.lock.withLock {
                    self.captured.append(String(decoding: combined, as: UTF8.self))
                    return (self.response, self.delay)
                }
                Task {
                    if delay > 0 { try? await Task.sleep(nanoseconds: delay) }
                    connection.send(content: output, completion: .contentProcessed { _ in connection.cancel() })
                }
            } else if !complete && error == nil && combined.count < 65536 {
                self.receive(connection, data: combined)
            } else { connection.cancel() }
        }
    }

    func respond(body: String, headers: [String: String] = [:], status: String = "200 OK", delayNanoseconds: UInt64 = 0) {
        let data = Data(body.utf8)
        let extra = headers.map { "\($0.key): \($0.value)\r\n" }.joined()
        lock.withLock { response = Data("HTTP/1.1 \(status)\r\nContent-Length: \(data.count)\r\nConnection: close\r\n\(extra)\r\n".utf8) + data; delay = delayNanoseconds }
    }

    func requests() -> [String] { lock.withLock { captured } }
    func stop() {
        listener.cancel()
        for connection in lock.withLock({ connections }) { connection.cancel() }
    }
}

func runCredentialRequestTests() async throws {
    for kind in ["openai", "claude"] {
        for endpoint in ["https://fixture.test", "https://fixture.test/v1", "https://fixture.test/proxy/V1///"] {
            let root = endpoint.replacingOccurrences(of: #"/+$"#, with: "", options: .regularExpression)
            for purpose in ["models", "test", "translation"] {
                let resource = purpose == "models" ? "/models" : kind == "claude" ? "/messages" : "/chat/completions"
                var object: [String: Any] = ["jobId": UUID().uuidString, "method": purpose == "models" ? "GET" : "POST", "url": root + "/v1" + resource, "headers": [:] as [String: String], "proxyMode": "system", "timeoutMs": 2000, "maxResponseBytes": 65536, "credential": ["source": "none"], "purpose": purpose, "owner": ["senderId": "fixed-path-window", "requestId": "fixed-path-request"], "provider": ["kind": kind, "endpoint": endpoint, "model": "model", "proxyMode": "system"]]
                if purpose != "models" { object["body"] = ["model": "model"] }
                _ = try CredentialHTTPRequest(JSONSerialization.data(withJSONObject: object))
                object["url"] = root + resource
                do {
                    _ = try CredentialHTTPRequest(JSONSerialization.data(withJSONObject: object))
                    throw ContractTestFailure(description: "native credentials must reject a request without the fixed versioned path")
                } catch TransportProtocolError.forbiddenDestination { }
            }
        }
    }

    try checkCredentialInspectionLimits()
    let server = try CredentialCaptureServer()
    let port = try await server.start()
    defer { server.stop() }
    let directory = FileManager.default.temporaryDirectory.appendingPathComponent("credential-request-\(UUID().uuidString)")
    defer { try? FileManager.default.removeItem(at: directory) }
    let store = try SecureCredentialStore(directory: directory, protection: CredentialProtection(backend: SyntheticKeyBackend()))
    let handler = ProtocolHandler(token: "synthetic-rpc-token", credentialStore: store)
    let rpcDirectory = directory.appendingPathComponent(".rpc")
    try FileRPCWorker.prepareDirectory(rpcDirectory)
    let rpcWorker = Task {
        await FileRPCWorker.run(directory: rpcDirectory, port: 49_153) { path, token, body in
            await handler.handle(path: path, authorization: "Bearer " + token, body: body)
        }
    }
    defer { rpcWorker.cancel() }
    func request(_ credential: [String: Any], endpoint: String, kind: String = "openai", headers: [String: String] = [:], purpose: String = "models", method: String = "GET", proxyMode: String = "direct", overrides: [String: Any] = [:]) async throws -> ProtocolResponse {
        var object: [String: Any] = [
            "jobId": UUID().uuidString, "method": method, "url": endpoint, "headers": headers,
            "proxyMode": proxyMode, "timeoutMs": 2000, "maxResponseBytes": 65536,
            "credential": credential, "purpose": purpose, "owner": ["senderId": "synthetic-window", "requestId": UUID().uuidString],
            "provider": ["kind": kind, "endpoint": "http://127.0.0.1:\(port)" + (kind == "deepseek" ? "/v1" : ""), "model": "synthetic-model", "proxyMode": proxyMode],
        ]
        if method == "POST" { object["body"] = ["model": "synthetic-model", "messages": []] }
        for (name, value) in overrides { object[name] = value }
        let now = Int64(Date().timeIntervalSince1970 * 1000)
        let stem = "transport-v2-\(String(now, radix: 36))-1-\(UUID().uuidString.lowercased().replacingOccurrences(of: "-", with: ""))"
        let responseFile = rpcDirectory.appendingPathComponent(stem + ".response.json")
        try JSONSerialization.data(withJSONObject: ["type": "request", "protocolVersion": 2, "createdAtMs": now, "port": 49_153, "token": "synthetic-rpc-token", "path": "/v2/request", "body": object]).write(to: rpcDirectory.appendingPathComponent(stem + ".request.json"))
        try Data().write(to: rpcDirectory.appendingPathComponent(stem + ".request.ready"))
        for _ in 0..<500 {
            if let data = try? Data(contentsOf: responseFile), let result = try JSONSerialization.jsonObject(with: data) as? [String: Any], let status = result["statusCode"] as? Int, let body = result["body"] as? [String: Any] {
                try FileManager.default.removeItem(at: responseFile)
                return .json(statusCode: status, body)
            }
            try await Task.sleep(nanoseconds: 10_000_000)
        }
        throw ContractTestFailure(description: "credential request FileRPC response timed out")
    }
    for name in ["Authorization", "authorization", "x-api-key", "X-Api-Key"] {
        let result = try await request(["source": "none"], endpoint: "http://127.0.0.1:\(port)/v1/models", headers: [name: "synthetic-must-not-send"])
        try check(result.statusCode == 400, "JS authentication headers must be rejected before network execution")
        try check(server.requests().isEmpty, "rejected authentication must not reach the provider")
    }
    let none = try await request(["source": "none"], endpoint: "http://127.0.0.1:\(port)/v1/models")
    try check(none.statusCode == 200 && !server.requests().last!.lowercased().contains("authorization:"), "explicit none must send no authentication")
    var state = try await store.initializeProfileState(commitID: UUID().uuidString, expectedStoreRevision: 0, profiles: [])
    var profiles: [StoredProviderProfile] = []
    for proxyMode in ["direct", "system"] {
    for kind in ["openai", "claude", "deepseek", "ollama"] {
        let id = UUID().uuidString.lowercased()
        let endpoint = "http://127.0.0.1:\(port)" + (kind == "deepseek" ? "/v1" : "")
        let fingerprint = CredentialCryptography.digest(try JSONSerialization.data(withJSONObject: ["kind": kind, "endpoint": endpoint, "proxyMode": proxyMode], options: [.sortedKeys, .withoutEscapingSlashes]))
        let profile = StoredProviderProfile(profileId: id, revision: 1, displayName: kind, kind: kind, endpoint: endpoint, endpointFingerprint: fingerprint, proxyMode: proxyMode, model: "synthetic-model", capability: nil)
        profiles.append(profile)
        let commit = UUID().uuidString
        let key = "synthetic-\(kind)-credential"
        state = try await store.saveProfile(CredentialProfileSave(commitID: commit, expectedStoreRevision: state.storeRevision, expectedProfileRevision: 0, profileID: id, profileState: StoredProfileState(profiles: profiles, activation: nil), requestDigest: CredentialCryptography.digest(Data(commit.utf8))), value: Data(key.utf8))
        let credential: [String: Any] = ["source": "saved", "profileId": id, "profileRevision": 1, "kind": kind, "endpointFingerprint": fingerprint]
        let url = endpoint + (kind == "ollama" ? "/api/tags" : ["openai", "claude"].contains(kind) ? "/v1/models" : "/models")
        let result = try await request(credential, endpoint: url, kind: kind, proxyMode: proxyMode)
        try check(result.statusCode == 200, "saved reference must execute a provider request")
        let sent = server.requests().last!.lowercased()
        try check(sent.contains(kind == "claude" ? "x-api-key: \(key)" : "authorization: bearer \(key)"), "native transport must inject the service-specific authentication")
        var stale = credential
        stale["profileRevision"] = 2
        let before = server.requests().count
        let rejected = try await request(stale, endpoint: url, kind: kind, proxyMode: proxyMode)
        try check(rejected.statusCode != 200 && server.requests().count == before, "stale reference must not execute")
        let wrongRoute = try await request(credential, endpoint: endpoint + "/unrelated", kind: kind, proxyMode: proxyMode)
        try check(wrongRoute.statusCode != 200 && server.requests().count == before, "saved credentials must be limited to their service route")
        let disabled = try await request(credential, endpoint: endpoint + (kind == "ollama" ? "/api/chat" : kind == "claude" ? "/v1/messages" : kind == "openai" ? "/v1/chat/completions" : "/chat/completions"), kind: kind, purpose: "translation", method: "POST", proxyMode: proxyMode)
        try check(disabled.statusCode != 200 && server.requests().count == before, "translation requires the current persisted activation")
        let activation = StoredActivationReference(profileId: id, profileRevision: 1, kind: kind, endpointFingerprint: fingerprint, credentialConfigured: true)
        state = try await store.commitProfileState(commitID: UUID().uuidString, expectedStoreRevision: state.storeRevision, profileState: StoredProfileState(profiles: profiles, activation: activation))
        let allowed = try await request(credential, endpoint: endpoint + (kind == "ollama" ? "/api/chat" : kind == "claude" ? "/v1/messages" : kind == "openai" ? "/v1/chat/completions" : "/chat/completions"), kind: kind, purpose: "translation", method: "POST", proxyMode: proxyMode)
        try check(allowed.statusCode == 200 && server.requests().count == before + 1, "active matching revision must authorize native translation")
        state = try await store.commitProfileState(commitID: UUID().uuidString, expectedStoreRevision: state.storeRevision, profileState: StoredProfileState(profiles: profiles, activation: nil))
        let escaped = key.unicodeScalars.map { String(format: "\\u%04x", $0.value) }.joined()
        for body in [key, "{\"content\":\"\(escaped)\"}", "{\"\(escaped)\":true}", "{\"content\":\"{\\\"value\\\":\\\"\(key)\\\"}\"}"] {
            server.respond(body: body)
            let reflected = try await request(credential, endpoint: url, kind: kind, proxyMode: proxyMode)
            let encoded = String(decoding: reflected.body, as: UTF8.self)
            try check(encoded.contains("credential-reflection") && !encoded.contains(key) && !encoded.contains(escaped), "provider reflection must be discarded before RPC serialization")
        }
        server.respond(body: "{}", headers: ["X-Echo": key], status: "500 Failed")
        let headerReflection = try await request(credential, endpoint: url, kind: kind, proxyMode: proxyMode)
        try check(String(decoding: headerReflection.body, as: UTF8.self).contains("credential-reflection"), "error response headers must also be guarded")
        server.respond(body: "{}")
        for overrides: [String: Any] in [
            ["apiKey": key],
            ["provider": ["kind": kind, "endpoint": endpoint, "model": "foreign-model", "proxyMode": proxyMode]],
            ["provider": ["kind": kind, "endpoint": endpoint + "/other", "model": "synthetic-model", "proxyMode": proxyMode]],
            ["body": ["model": "foreign-model"]],
            ["method": "DELETE"],
        ] {
            let before = server.requests().count
            let mismatch = try await request(credential, endpoint: url, kind: kind, proxyMode: proxyMode, overrides: overrides)
            try check(mismatch.statusCode != 200 && server.requests().count == before, "mismatched config, methods and JS secrets must be rejected before networking")
        }
        server.respond(body: "{}", headers: ["Location": endpoint + "/unrelated"], status: "302 Found")
        let beforeRedirect = server.requests().count
        let redirect = try await request(credential, endpoint: url, kind: kind, proxyMode: proxyMode)
        try check(redirect.statusCode == 200 && server.requests().count == beforeRedirect + 1, "neither transport may forward saved credentials through redirects")
        server.respond(body: "{}")
    }
    }
    let first = profiles[0]
    let file = directory.appendingPathComponent("credentials.json")
    let original = try Data(contentsOf: file)
    var damaged = try JSONSerialization.jsonObject(with: original) as! [String: Any]
    var encrypted = damaged["credentials"] as! [String: Any]
    encrypted[first.profileId] = ["credentialId": UUID().uuidString, "envelope": "damaged-opaque-value"]
    damaged["credentials"] = encrypted
    try JSONSerialization.data(withJSONObject: damaged).write(to: file)
    let reference: [String: Any] = ["source": "saved", "profileId": first.profileId, "profileRevision": 1, "kind": first.kind, "endpointFingerprint": first.endpointFingerprint]
    let beforeDamage = server.requests().count
    let unavailable = try await request(reference, endpoint: first.endpoint + "/v1/models")
    try check(unavailable.statusCode != 200 && server.requests().count == beforeDamage, "damaged credential must never fall back to unauthenticated execution")
    try credentialCheck(Data(contentsOf: file) == JSONSerialization.data(withJSONObject: damaged), "failed read must not rewrite opaque stored data")
    try original.write(to: file)
    let cleared = StoredProviderProfile(profileId: first.profileId, revision: 2, displayName: first.displayName, kind: first.kind, endpoint: first.endpoint, endpointFingerprint: first.endpointFingerprint, proxyMode: first.proxyMode, model: first.model, capability: nil)
    profiles[0] = cleared
    let clearCommit = UUID().uuidString
    state = try await store.saveProfile(CredentialProfileSave(commitID: clearCommit, expectedStoreRevision: state.storeRevision, expectedProfileRevision: 1, profileID: first.profileId, profileState: StoredProfileState(profiles: profiles, activation: nil), requestDigest: CredentialCryptography.digest(Data(clearCommit.utf8))), value: Data())
    var keyless = reference
    keyless["profileRevision"] = 2
    let withoutKey = try await request(keyless, endpoint: first.endpoint + "/v1/models")
    try check(withoutKey.statusCode == 200 && !server.requests().last!.lowercased().contains("authorization:"), "saved Profile with no entry must send no authentication")
}


func checkCredentialInspectionLimits() throws {
    let key = Data("synthetic-inspection-key".utf8)
    for sample in [
        Data([0xff]),
        Data((String(repeating: "[", count: 20) + "0" + String(repeating: "]", count: 20)).utf8),
        Data(("[" + Array(repeating: "0", count: 65_536).joined(separator: ",") + "]").utf8),
        Data(String(repeating: "a", count: 16 * 1_048_576 + 1).utf8),
    ] {
        do {
            try CredentialResponseGuard.validate(body: sample, headers: [], credential: key)
            throw ContractTestFailure(description: "uninspectable credential response must be rejected")
        } catch CredentialFailure.reflection { }
    }
    do {
        try CredentialResponseGuard.validate(body: Data("{}".utf8), headers: [String(repeating: "a", count: 65_537)], credential: key)
        throw ContractTestFailure(description: "oversized response headers must be rejected")
    } catch CredentialFailure.reflection { }
}
