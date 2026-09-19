import Foundation

func runServerTests() async throws {
    try check(TransportServer.boundHost == "127.0.0.1", "server must bind IPv4 loopback only")
    let daemonArguments = try DetachedBootstrap.daemonArguments(
        [
            "--data-directory", "/private/data", "--ready-file",
            "/private/data/.ready/transport-test.json", "--rpc-session", "abc-1-session",
        ],
        parentPID: 123
    )
    try check(
        daemonArguments == [
            "serve", "--data-directory", "/private/data", "--ready-file",
            "/private/data/.ready/transport-test.json", "--rpc-session", "abc-1-session",
            "--parent-pid", "123",
        ],
        "bootstrap must pass the real parent PID to serve mode"
    )
    try expectFailure("bootstrap must reject init as parent") {
        _ = try DetachedBootstrap.daemonArguments([], parentPID: 1)
    }

    let credentialDirectory = FileManager.default.temporaryDirectory
        .appendingPathComponent("subtandem-credential-contract-\(UUID().uuidString)", isDirectory: true)
    let credentialStore = try SecureCredentialStore(directory: credentialDirectory)
    defer { try? FileManager.default.removeItem(at: credentialDirectory) }
    let handler = ProtocolHandler(token: "correct-token", credentialStore: credentialStore)
    let unauthorized = await handler.handle(path: "/v1/health", authorization: "Bearer wrong", body: Data("{}".utf8))
    try check(unauthorized.statusCode == 401, "wrong bearer token must be rejected")
    let bodylessHealth = await handler.handle(
        path: "/v1/health",
        authorization: "Bearer correct-token",
        body: Data()
    )
    try check(bodylessHealth.statusCode == 200, "IINA may omit the empty health JSON body")
    let invalidHealth = await handler.handle(
        path: "/v1/health",
        authorization: "Bearer correct-token",
        body: Data("{\"unexpected\":true}".utf8)
    )
    try check(invalidHealth.statusCode == 400, "health must reject caller-controlled fields")
    let oversized = await handler.handle(
        path: "/v1/health",
        authorization: "Bearer correct-token",
        body: Data(repeating: 0, count: ProtocolLimits.maxRequestBytes + 1)
    )
    try check(oversized.statusCode == 413, "oversized RPC body must be rejected")

    let profileID = "7a90a4e6-cc4f-4f59-99b7-8ff522f887ae"
    let profile: [String: Any] = [
        "profileId": profileID,
        "revision": 1,
        "displayName": "A",
        "kind": "openai",
        "endpoint": "https://example.test/v1",
        "endpointFingerprint": "fingerprint-a",
        "proxyMode": "direct",
        "model": "model-a",
    ]
    let uninitialized = await handler.handle(
        path: "/v1/profile-state",
        authorization: "Bearer correct-token",
        body: try JSONSerialization.data(withJSONObject: ["action": "read"])
    )
    let uninitializedJSON = try JSONSerialization.jsonObject(with: uninitialized.body) as? [String: Any]
    try check(uninitialized.statusCode == 200, "uninitialized Profile state read must succeed")
    try check(uninitializedJSON?["initialized"] as? Bool == false, "new store must be uninitialized")
    try check(uninitializedJSON?["storeRevision"] as? Int == 0, "new store revision must be zero")
    try check(uninitializedJSON?["profileState"] is NSNull, "uninitialized state must be null")

    let initializeCommitID = "00000000-0000-4000-8000-000000000001"
    let initialized = await handler.handle(
        path: "/v1/profile-state",
        authorization: "Bearer correct-token",
        body: try JSONSerialization.data(withJSONObject: [
            "action": "initialize",
            "commitId": initializeCommitID,
            "expectedStoreRevision": 0,
            "profiles": [profile],
        ])
    )
    let initializedJSON = try JSONSerialization.jsonObject(with: initialized.body) as? [String: Any]
    try check(initialized.statusCode == 200, "Profile state initialization must succeed")
    try check(initializedJSON?["storeRevision"] as? Int == 1, "initialization must advance store revision")
    let initializedProfileState = initializedJSON?["profileState"] as? [String: Any]
    try check(initializedProfileState?["activation"] is NSNull, "initialization must encode disabled activation as null")

    let initializedRead = await handler.handle(
        path: "/v1/profile-state",
        authorization: "Bearer correct-token",
        body: try JSONSerialization.data(withJSONObject: ["action": "read"])
    )
    let initializedReadJSON = try JSONSerialization.jsonObject(with: initializedRead.body) as? [String: Any]
    let initializedReadProfileState = initializedReadJSON?["profileState"] as? [String: Any]
    try check(initializedReadProfileState?["activation"] is NSNull, "read must encode disabled activation as null")

    let readCredentialBody = try JSONSerialization.data(withJSONObject: [
        "action": "read", "profileId": profileID,
    ])
    let missingCredential = await handler.handle(
        path: "/v1/credentials",
        authorization: "Bearer correct-token",
        body: readCredentialBody
    )
    let missingCredentialJSON = try JSONSerialization.jsonObject(with: missingCredential.body) as? [String: Any]
    try check(missingCredential.statusCode == 200, "missing credential read must succeed")
    try check(missingCredentialJSON?["fields"] is NSNull, "missing credential must serialize as JSON null")

    let saveCredentialBody = try JSONSerialization.data(withJSONObject: [
        "action": "write",
        "profileId": profileID,
        "fields": ["apiKey": "private-key"],
        "commitId": "00000000-0000-4000-8000-000000000002",
        "expectedStoreRevision": 1,
        "expectedProfileRevision": 1,
    ])
    let savedCredential = await handler.handle(
        path: "/v1/credentials",
        authorization: "Bearer correct-token",
        body: saveCredentialBody
    )
    let savedCredentialJSON = try JSONSerialization.jsonObject(with: savedCredential.body) as? [String: Any]
    try check(savedCredential.statusCode == 200, "versioned credential write must succeed")
    try check(savedCredentialJSON?["storeRevision"] as? Int == 2, "credential write must advance shared revision")
    try check(savedCredentialJSON?["credentials"] == nil, "credential response must not expose secrets")
    try check(savedCredentialJSON?["credentialConfigured"] as? [String: Bool] == [profileID: true], "credential response must expose only configured state")
    let credentialProfileState = savedCredentialJSON?["profileState"] as? [String: Any]
    try check(credentialProfileState?["activation"] is NSNull, "credential write must encode disabled activation as null")
    let storedCredential = try await credentialStore.read(profileID: profileID)
    try check(storedCredential == ["apiKey": "private-key"], "credential must round-trip")
    let attributes = try FileManager.default.attributesOfItem(
        atPath: credentialDirectory.appendingPathComponent("credentials.json").path
    )
    let permissions = (attributes[.posixPermissions] as? NSNumber)?.intValue
    try check(permissions == 0o600, "credential file must be mode 0600")
    let versionedData = try Data(contentsOf: credentialDirectory.appendingPathComponent("credentials.json"))
    let versionedJSON = try JSONSerialization.jsonObject(with: versionedData) as? [String: Any]
    try check(versionedJSON?["storeRevision"] as? Int == 2, "credential writes must advance the shared store revision")
    try check(versionedJSON?["lastCommit"] is [String: Any], "credential writes must persist an idempotency receipt")
    let fixedLock = credentialDirectory.appendingPathComponent(".credentials.lock")
    try check(FileManager.default.fileExists(atPath: fixedLock.path), "all mutations must use one fixed sidecar lock")
    let repeatedCredential = await handler.handle(
        path: "/v1/credentials",
        authorization: "Bearer correct-token",
        body: saveCredentialBody
    )
    let repeatedCredentialJSON = try JSONSerialization.jsonObject(with: repeatedCredential.body) as? [String: Any]
    try check(repeatedCredentialJSON?["storeRevision"] as? Int == 2, "same credential commit must be idempotent")
    let changedCredentialBody = try JSONSerialization.data(withJSONObject: [
        "action": "write",
        "profileId": profileID,
        "fields": ["apiKey": "different-key"],
        "commitId": "00000000-0000-4000-8000-000000000002",
        "expectedStoreRevision": 1,
        "expectedProfileRevision": 1,
    ])
    let changedCredential = await handler.handle(
        path: "/v1/credentials",
        authorization: "Bearer correct-token",
        body: changedCredentialBody
    )
    try check(changedCredential.statusCode == 409, "same commit ID with different secret must conflict")

    let deleteProfileBody = try JSONSerialization.data(withJSONObject: [
        "action": "commit",
        "commitId": "00000000-0000-4000-8000-000000000003",
        "expectedStoreRevision": 2,
        "profileState": ["profiles": [], "activation": NSNull()],
    ])
    let deletedProfile = await handler.handle(
        path: "/v1/profile-state",
        authorization: "Bearer correct-token",
        body: deleteProfileBody
    )
    try check(deletedProfile.statusCode == 200, "Profile transaction delete must succeed")
    let deletedProfileJSON = try JSONSerialization.jsonObject(with: deletedProfile.body) as? [String: Any]
    let deletedProfileState = deletedProfileJSON?["profileState"] as? [String: Any]
    try check(deletedProfileState?["activation"] is NSNull, "commit must encode disabled activation as null")
    let credentialAfterDelete = try await credentialStore.read(profileID: profileID)
    try check(credentialAfterDelete == nil, "Profile transaction must delete its credential")

    let openedProfile = await handler.handle(
        path: "/v1/profile-state",
        authorization: "Bearer correct-token",
        body: try JSONSerialization.data(withJSONObject: [
            "action": "open",
            "commitId": "00000000-0000-4000-8000-000000000004",
        ])
    )
    let openedProfileJSON = try JSONSerialization.jsonObject(with: openedProfile.body) as? [String: Any]
    let openedProfileState = openedProfileJSON?["profileState"] as? [String: Any]
    try check(openedProfile.statusCode == 200, "Profile state open must succeed")
    try check(openedProfileState?["activation"] is NSNull, "open must encode disabled activation as null")
    let oldDeleteCredential = await handler.handle(
        path: "/v1/credentials",
        authorization: "Bearer correct-token",
        body: try JSONSerialization.data(withJSONObject: ["action": "delete", "profileId": profileID])
    )
    try check(oldDeleteCredential.statusCode == 400, "independent credential delete must be removed")
    let invalidCredential = await handler.handle(
        path: "/v1/credentials",
        authorization: "Bearer correct-token",
        body: Data("{\"action\":\"read\",\"profileId\":\"not-a-uuid\"}".utf8)
    )
    try check(invalidCredential.statusCode == 400, "invalid profile IDs must be rejected")

    let encoded = try ReadyFrame(
        port: 49152,
        token: "opaque-token",
        createdAtMs: 10_000
    ).encodedLine()
    try check(encoded.filter { $0 == "\n" }.count == 1 && encoded.hasSuffix("\n"), "startup frame must be one JSON line")
    try check(!encoded.contains("debug"), "startup frame must not include logs")
    let readyRoot = FileManager.default.temporaryDirectory
        .appendingPathComponent("subtandem-ready-\(UUID().uuidString)", isDirectory: true)
    let readyFile = readyRoot
        .appendingPathComponent(".ready", isDirectory: true)
        .appendingPathComponent("transport-test.json")
    defer { try? FileManager.default.removeItem(at: readyRoot) }
    try ReadyFileWriter.write(
        ReadyFrame(port: 49152, token: "opaque-token", createdAtMs: 10_000),
        to: readyFile
    )
    let readyDirectoryMode = try FileManager.default.attributesOfItem(
        atPath: readyFile.deletingLastPathComponent().path
    )[.posixPermissions] as? NSNumber
    let readyFileMode = try FileManager.default.attributesOfItem(
        atPath: readyFile.path
    )[.posixPermissions] as? NSNumber
    try check(readyDirectoryMode?.intValue == 0o700, "ready directory must use mode 0700")
    try check(readyFileMode?.intValue == 0o600, "ready file must use mode 0600")
    let readyText = try String(contentsOf: readyFile, encoding: .utf8)
    let readyJSON = try JSONSerialization.jsonObject(with: Data(readyText.utf8)) as? [String: Any]
    try check(readyJSON?["port"] as? Int == 49152, "ready file must contain the bound port")
    try check(readyJSON?["token"] as? String == "opaque-token", "ready file must contain the session token")
    try check(readyJSON?["createdAtMs"] as? Int == 10_000, "ready file must contain the freshness timestamp")
    try expectFailure("ready file publication must not replace an existing file") {
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

    let body = Data("{}".utf8)
    let header = Data((
        "POST /v1/health HTTP/1.1\r\n" +
        "Content-Type: application/json\r\n" +
        "Content-Length: \(body.count)\r\n" +
        "Authorization: Bearer correct-token\r\n\r\n"
    ).utf8)
    guard case .incomplete = TransportServer.parseRequest(header) else {
        throw ContractTestFailure(description: "header-only TCP chunk must remain incomplete")
    }
    var splitFrame = header
    splitFrame.append(body.prefix(1))
    guard case .incomplete = TransportServer.parseRequest(splitFrame) else {
        throw ContractTestFailure(description: "partial JSON TCP chunk must remain incomplete")
    }
    splitFrame.append(body.dropFirst(1))
    guard case .complete(let path, let authorization, let parsedBody) = TransportServer.parseRequest(splitFrame) else {
        throw ContractTestFailure(description: "complete split request must parse")
    }
    try check(path == "/v1/health", "parsed request path must match")
    try check(authorization == "Bearer correct-token", "parsed authorization must match")
    try check(parsedBody == body, "parsed split body must match")

    let liveness = LivenessState(parentPID: 999_999, idleTimeout: 1)
    try check(liveness.shouldExit(parentIsAlive: false), "parent loss must request exit")
    liveness.requestShutdown()
    try check(liveness.shouldExit(parentIsAlive: true), "authenticated shutdown must request exit")

    BlockingURLProtocol.reset()
    let lifecycleClient = makeControlledHTTPClient()
    let lifecycleHandler = ProtocolHandler(
        token: "correct-token",
        httpClient: lifecycleClient,
        credentialStore: credentialStore
    )
    let activeJobID = UUID().uuidString
    let activeRequest = try encodedTransportRequest(jobID: activeJobID)
    let activeResponse = Task {
        await lifecycleHandler.handle(
            path: "/v1/request",
            authorization: "Bearer correct-token",
            body: activeRequest
        )
    }
    let activeRequestStarted = await BlockingURLProtocol.waitUntilStarted(1)
    try check(
        activeRequestStarted,
        "the shutdown contract requires an active upstream request"
    )
    let firstShutdown = await lifecycleHandler.handle(
        path: "/v1/shutdown",
        authorization: "Bearer correct-token",
        body: Data("{}".utf8)
    )
    let repeatedShutdown = await lifecycleHandler.handle(
        path: "/v1/shutdown",
        authorization: "Bearer correct-token",
        body: Data("{}".utf8)
    )
    try check(firstShutdown.statusCode == 200, "shutdown must retain its existing response")
    try check(repeatedShutdown.statusCode == 200, "repeated shutdown must be idempotent")
    try check(lifecycleClient.activeJobCount() == 0, "shutdown must clear all active jobs")
    let cancelledResponse = await activeResponse.value
    try check(cancelledResponse.statusCode == 409, "shutdown must give the active request one cancelled terminal response")
    let rejectedResponse = await lifecycleHandler.handle(
        path: "/v1/request",
        authorization: "Bearer correct-token",
        body: try encodedTransportRequest(jobID: UUID().uuidString)
    )
    try check(rejectedResponse.statusCode == 409, "shutdown must reject new upstream requests")
    BlockingURLProtocol.completeAll()
    try check(lifecycleClient.activeJobCount() == 0, "late callbacks must not restore closed jobs")
}
