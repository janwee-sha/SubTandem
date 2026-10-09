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
    let unauthorized = await handler.handle(path: "/v2/health", authorization: "Bearer wrong", body: Data("{}".utf8))
    try check(unauthorized.statusCode == 401, "wrong bearer token must be rejected")
    let bodylessHealth = await handler.handle(
        path: "/v2/health",
        authorization: "Bearer correct-token",
        body: Data()
    )
    try check(bodylessHealth.statusCode == 200, "IINA may omit the empty health JSON body")
    let invalidHealth = await handler.handle(
        path: "/v2/health",
        authorization: "Bearer correct-token",
        body: Data("{\"unexpected\":true}".utf8)
    )
    try check(invalidHealth.statusCode == 400, "health must reject caller-controlled fields")
    let oversized = await handler.handle(
        path: "/v2/health",
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
        "endpoint": "https://example.test",
        "endpointFingerprint": "77e6ddaebd4c56f3f66bb6ff4c788c4b4b5057a5410534047a17146c2daf1807",
        "proxyMode": "direct",
        "model": "model-a",
    ]
    let uninitialized = await handler.handle(
        path: "/v2/profile-state",
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
        path: "/v2/profile-state",
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
        path: "/v2/profile-state",
        authorization: "Bearer correct-token",
        body: try JSONSerialization.data(withJSONObject: ["action": "read"])
    )
    let initializedReadJSON = try JSONSerialization.jsonObject(with: initializedRead.body) as? [String: Any]
    let initializedReadProfileState = initializedReadJSON?["profileState"] as? [String: Any]
    try check(initializedReadProfileState?["activation"] is NSNull, "read must encode disabled activation as null")

    for action in ["read", "write", "delete"] {
        let rejected = await handler.handle(path: "/v2/credentials", authorization: "Bearer correct-token", body: try JSONSerialization.data(withJSONObject: ["action": action, "profileId": profileID]))
        try check(rejected.statusCode == 404, "plaintext credential endpoint must be removed")
    }

    let deleteProfileBody = try JSONSerialization.data(withJSONObject: [
        "action": "commit",
        "commitId": "00000000-0000-4000-8000-000000000003",
        "expectedStoreRevision": 1,
        "profileState": ["profiles": [], "activation": NSNull()],
    ])
    let deletedProfile = await handler.handle(
        path: "/v2/profile-state",
        authorization: "Bearer correct-token",
        body: deleteProfileBody
    )
    try check(deletedProfile.statusCode == 200, "Profile transaction delete must succeed")
    let deletedProfileJSON = try JSONSerialization.jsonObject(with: deletedProfile.body) as? [String: Any]
    let deletedProfileState = deletedProfileJSON?["profileState"] as? [String: Any]
    try check(deletedProfileState?["activation"] is NSNull, "commit must encode disabled activation as null")
    let afterDelete = try await credentialStore.readProfileState()
    try check(afterDelete.credentialConfigured.isEmpty, "Profile transaction must remove its credential projection")

    for kind in ["openai", "claude", "deepseek", "ollama"] {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent("subtandem-profile-key-\(UUID().uuidString)", isDirectory: true)
        defer { try? FileManager.default.removeItem(at: directory) }
        let store = try SecureCredentialStore(directory: directory, protection: CredentialProtection(backend: SyntheticKeyBackend()))
        var snapshot = try await store.initializeProfileState(commitID: UUID().uuidString, expectedStoreRevision: 0, profiles: [])
        for revision in 1...3 {
            let endpoint = revision == 1 ? "https://example.test" : "https://other.test/v2"
            let proxy = revision == 1 ? "direct" : "system"
            let selectedKind = revision == 3 ? (kind == "ollama" ? "openai" : "ollama") : kind
            let fingerprint = CredentialCryptography.digest(try JSONSerialization.data(withJSONObject: ["kind": selectedKind, "endpoint": endpoint, "proxyMode": proxy], options: [.sortedKeys, .withoutEscapingSlashes]))
            let candidate = StoredProviderProfile(profileId: profileID, revision: revision, displayName: "Changed", kind: selectedKind, endpoint: endpoint, endpointFingerprint: fingerprint, proxyMode: proxy, model: "model", capability: nil)
            let state = StoredProfileState(profiles: [candidate], activation: nil)
            try await expectCredentialAsyncFailure("metadata-only commit cannot add or edit a Profile") {
                _ = try await store.commitProfileState(commitID: UUID().uuidString, expectedStoreRevision: snapshot.storeRevision, profileState: state)
            }
            let commit = UUID().uuidString
            let value = revision == 3 ? Data() : Data("synthetic-current-input".utf8)
            snapshot = try await store.saveProfile(CredentialProfileSave(commitID: commit, expectedStoreRevision: snapshot.storeRevision, expectedProfileRevision: revision - 1, profileID: profileID, profileState: state, requestDigest: CredentialCryptography.digest(Data(commit.utf8))), value: value)
            let reopened = try SecureCredentialStore(directory: directory, protection: CredentialProtection(backend: SyntheticKeyBackend()))
            let current = try await reopened.readCredential(profileID: profileID, expectedProfileRevision: revision)
            try check(current == (value.isEmpty ? nil : value), "\(kind) Save must persist exactly the current input across restart")
        }
    }

    let openedProfile = await handler.handle(
        path: "/v2/profile-state",
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

    let keylessDirectory = FileManager.default.temporaryDirectory
        .appendingPathComponent("subtandem-keyless-claude-\(UUID().uuidString)", isDirectory: true)
    defer { try? FileManager.default.removeItem(at: keylessDirectory) }
    let keylessStore = try SecureCredentialStore(directory: keylessDirectory)
    let keylessProfile = StoredProviderProfile(
        profileId: "7a90a4e6-cc4f-4f59-99b7-8ff522f887af",
        revision: 1,
        displayName: "Keyless Claude",
        kind: "claude",
        endpoint: "https://compatible.example",
        endpointFingerprint: CredentialCryptography.digest(try JSONSerialization.data(withJSONObject: ["kind": "claude", "endpoint": "https://compatible.example", "proxyMode": "direct"], options: [.sortedKeys, .withoutEscapingSlashes])),
        proxyMode: "direct",
        model: "exact-model",
        capability: nil
    )
    let keylessInitialized = try await keylessStore.initializeProfileState(
        commitID: "00000000-0000-4000-8000-000000000005",
        expectedStoreRevision: 0,
        profiles: [keylessProfile]
    )
    let keylessActivation = StoredActivationReference(
        profileId: keylessProfile.profileId,
        profileRevision: keylessProfile.revision,
        kind: keylessProfile.kind,
        endpointFingerprint: keylessProfile.endpointFingerprint,
        credentialConfigured: false
    )
    let keylessCommitted = try await keylessStore.commitProfileState(
        commitID: "00000000-0000-4000-8000-000000000006",
        expectedStoreRevision: keylessInitialized.storeRevision,
        profileState: StoredProfileState(profiles: [keylessProfile], activation: keylessActivation)
    )
    try check(keylessCommitted.profileState?.activation == keylessActivation, "keyless Claude activation must commit")
    let reopenedKeylessStore = try SecureCredentialStore(directory: keylessDirectory)
    let restoredKeyless = try await reopenedKeylessStore.readProfileState()
    try check(restoredKeyless.profileState?.activation == keylessActivation, "keyless Claude activation must survive restart")
    try check(restoredKeyless.invalidActivation != true, "keyless Claude activation must remain valid")

    let oldDeleteCredential = await handler.handle(
        path: "/v2/credentials",
        authorization: "Bearer correct-token",
        body: try JSONSerialization.data(withJSONObject: ["action": "delete", "profileId": profileID])
    )
    try check(oldDeleteCredential.statusCode == 404, "independent credential delete must be removed")
    let invalidCredential = await handler.handle(
        path: "/v2/credentials",
        authorization: "Bearer correct-token",
        body: Data("{\"action\":\"read\",\"profileId\":\"not-a-uuid\"}".utf8)
    )
    try check(invalidCredential.statusCode == 404, "invalid profile IDs must be rejected")

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
        "POST /v2/health HTTP/1.1\r\n" +
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
    try check(path == "/v2/health", "parsed request path must match")
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
            path: "/v2/request",
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
        path: "/v2/shutdown",
        authorization: "Bearer correct-token",
        body: Data("{}".utf8)
    )
    let repeatedShutdown = await lifecycleHandler.handle(
        path: "/v2/shutdown",
        authorization: "Bearer correct-token",
        body: Data("{}".utf8)
    )
    try check(firstShutdown.statusCode == 200, "shutdown must retain its existing response")
    try check(repeatedShutdown.statusCode == 200, "repeated shutdown must be idempotent")
    try check(lifecycleClient.activeJobCount() == 0, "shutdown must clear all active jobs")
    let cancelledResponse = await activeResponse.value
    try check(cancelledResponse.statusCode == 409, "shutdown must give the active request one cancelled terminal response")
    let rejectedResponse = await lifecycleHandler.handle(
        path: "/v2/request",
        authorization: "Bearer correct-token",
        body: try encodedTransportRequest(jobID: UUID().uuidString)
    )
    try check(rejectedResponse.statusCode == 409, "shutdown must reject new upstream requests")
    BlockingURLProtocol.completeAll()
    try check(lifecycleClient.activeJobCount() == 0, "late callbacks must not restore closed jobs")
}
