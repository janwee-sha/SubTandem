import CryptoKit
import Darwin
import Foundation

private let secureStoreProfileID = "10000000-0000-4000-8000-000000000001"
private let secureStoreOtherID = "10000000-0000-4000-8000-000000000002"

private func secureStoreProfile(_ id: String = secureStoreProfileID, revision: Int = 1) -> StoredProviderProfile {
    StoredProviderProfile(profileId: id, revision: revision, displayName: "Synthetic", kind: "openai", endpoint: "https://example.test/v1", endpointFingerprint: "0d60715773b0025a549a09f48db8f58ac0f08cd3fb973bf8eca151f51a7eb4d8", proxyMode: "direct", model: "synthetic-model", capability: nil)
}

private func secureStoreInput(revision: Int, profileRevision: Int = 0, profiles: [StoredProviderProfile]? = nil, commitID: String = UUID().uuidString) -> CredentialProfileSave {
    CredentialProfileSave(commitID: commitID, expectedStoreRevision: revision, expectedProfileRevision: profileRevision, profileID: secureStoreProfileID, profileState: StoredProfileState(profiles: profiles ?? [secureStoreProfile(revision: profileRevision + 1)], activation: nil), requestDigest: CredentialCryptography.digest(Data("synthetic-encrypted-frame-\(commitID)".utf8)))
}

private func secureStoreDirectory() throws -> URL {
    let directory = FileManager.default.temporaryDirectory.appendingPathComponent("subtandem-secure-store-\(UUID().uuidString)")
    try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: false, attributes: [.posixPermissions: 0o700])
    return directory
}

private func secureStoreDocument(_ directory: URL) throws -> [String: Any] {
    try JSONSerialization.jsonObject(with: Data(contentsOf: directory.appendingPathComponent("credentials.json"))) as! [String: Any]
}

private func writeSecureStoreDocument(_ object: [String: Any], directory: URL) throws {
    try JSONSerialization.data(withJSONObject: object, options: [.sortedKeys]).write(to: directory.appendingPathComponent("credentials.json"))
}

private func expectSecureStoreFailure(_ message: String, _ operation: () async throws -> Void) async throws {
    do {
        try await operation()
    } catch is ContractTestFailure {
        throw ContractTestFailure(description: message)
    } catch {
        return
    }
    throw ContractTestFailure(description: message)
}

func runSecureCredentialStoreTests() async throws {
    try await secureStoreProtocolSave()
    try await secureStoreInitializesV2()
    try await secureStoreAtomicSaveAndReceipt()
    try await secureStoreFailureMatrix()
    try await secureStorePreservesOpaqueEntries()
    try await secureStoreRejectsDamagedDocuments()
    try await secureStoreCompareAndSwap()
    try await secureStoreCrossProcessLock()
}

func runSecureStoreWorker() async throws {
    let environment = ProcessInfo.processInfo.environment
    guard let path = environment["SUBTANDEM_STORE_TEST_DIRECTORY"] else { throw ContractTestFailure(description: "worker directory missing") }
    let directory = URL(fileURLWithPath: path)
    let store = try SecureCredentialStore(directory: directory)
    for _ in 0..<2000 {
        if FileManager.default.fileExists(atPath: directory.appendingPathComponent("start-workers").path) { break }
        try await Task.sleep(for: .milliseconds(5))
    }
    do {
        _ = try await store.saveProfile(secureStoreInput(revision: 1), value: Data())
        exit(0)
    } catch TransportProtocolError.profileStateConflict {
        exit(17)
    }
}

private func secureStoreCrossProcessLock() async throws {
    let directory = try secureStoreDirectory()
    defer { try? FileManager.default.removeItem(at: directory) }
    let store = try SecureCredentialStore(directory: directory)
    _ = try await store.initializeProfileState(commitID: UUID().uuidString, expectedStoreRevision: 0, profiles: [])
    var children: [Process] = []
    for _ in 0..<2 {
        let child = Process()
        child.executableURL = URL(fileURLWithPath: CommandLine.arguments[0])
        var environment = ProcessInfo.processInfo.environment
        environment["SUBTANDEM_NATIVE_TEST"] = "credential-store-worker"
        environment["SUBTANDEM_STORE_TEST_DIRECTORY"] = directory.path
        child.environment = environment
        try child.run()
        children.append(child)
    }
    defer { for child in children where child.isRunning { child.terminate() } }
    try Data().write(to: directory.appendingPathComponent("start-workers"))
    for child in children { child.waitUntilExit() }
    try check(children.map(\.terminationStatus).sorted() == [0, 17], "two helper processes must serialize under the fixed lock and have one CAS winner")
    let result = try await store.readProfileState()
    try check(result.storeRevision == 2 && result.profileState?.profiles.count == 1, "cross-process race must produce one intact atomic snapshot")
}

private func secureStoreInitializesV2() async throws {
    let directory = try secureStoreDirectory()
    defer { try? FileManager.default.removeItem(at: directory) }
    let store = try SecureCredentialStore(directory: directory)
    let empty = try await store.readProfileState()
    try check(!empty.initialized && empty.storeRevision == 0, "missing storage must remain uninitialized before its first commit")
    let initialized = try await store.initializeProfileState(commitID: UUID().uuidString, expectedStoreRevision: 0, profiles: [])
    let document = try secureStoreDocument(directory)
    try check(document["formatVersion"] as? Int == 2, "new Profile storage must persist formatVersion 2")
    try check(UUID(uuidString: document["storeId"] as? String ?? "") != nil, "v2 storage must have a stable random store identity")
    try check(document["keyRing"] as? [String: String] == [:], "empty storage must not create a hardware key")
    let reopened = try SecureCredentialStore(directory: directory)
    let snapshot = try await reopened.readProfileState()
    try check(snapshot == initialized, "reopening must preserve committed state")
    let unchanged = try secureStoreDocument(directory)
    try check(unchanged["storeId"] as? String == document["storeId"] as? String, "reopening must not rotate the store identity")
    let attributes = try FileManager.default.attributesOfItem(atPath: directory.appendingPathComponent("credentials.json").path)
    try check((attributes[.posixPermissions] as? NSNumber)?.intValue == 0o600, "committed credentials must be private")
}

private func secureStoreAtomicSaveAndReceipt() async throws {
    let directory = try secureStoreDirectory()
    defer { try? FileManager.default.removeItem(at: directory) }
    let store = try SecureCredentialStore(directory: directory, protection: CredentialProtection(backend: SyntheticKeyBackend()))
    let initial = try await store.initializeProfileState(commitID: UUID().uuidString, expectedStoreRevision: 0, profiles: [])
    let input = secureStoreInput(revision: initial.storeRevision)
    let value = Data("synthetic-key-秘密-atomic".utf8)
    let saved = try await store.saveProfile(input, value: value)
    try check(saved.profileState == input.profileState && saved.credentialConfigured[secureStoreProfileID] == true, "profile and credential must commit together")
    let loaded = try await store.readCredential(profileID: secureStoreProfileID, expectedProfileRevision: 1)
    try check(loaded == value, "native request use must recover the committed value")
    let bytes = try Data(contentsOf: directory.appendingPathComponent("credentials.json"))
    try check(bytes.range(of: value) == nil && !String(decoding: bytes, as: UTF8.self).contains("apiKey"), "v2 encoding must not contain plaintext fields")
    let denied = try SecureCredentialStore(directory: directory, protection: CredentialProtection(backend: DeniedKeyBackend()))
    let retry = try await denied.saveProfile(input, value: Data())
    try check(retry == saved, "exact recent receipt must confirm before hardware/decryption access")
    let different = CredentialProfileSave(commitID: input.commitID, expectedStoreRevision: input.expectedStoreRevision, expectedProfileRevision: 0, profileID: secureStoreProfileID, profileState: input.profileState, requestDigest: String(repeating: "0", count: 64))
    try await expectSecureStoreFailure("reusing commit ID with a different sealed frame must fail") { _ = try await denied.saveProfile(different, value: Data()) }
    let clear = secureStoreInput(revision: saved.storeRevision, profileRevision: 1)
    let cleared = try await denied.saveProfile(clear, value: Data())
    try check(cleared.credentialConfigured[secureStoreProfileID] == false, "explicit empty save must clear without hardware")
    try await expectSecureStoreFailure("a later commit must prevent fabricated historical success") { _ = try await denied.saveProfile(input, value: Data()) }
}

private func secureStoreFailureMatrix() async throws {
    for stage: CredentialPersistStage in [.beforeWrite, .beforeFsync, .beforeRename, .afterRename, .beforeDirectoryFsync, .beforeReadback] {
        let directory = try secureStoreDirectory()
        defer { try? FileManager.default.removeItem(at: directory) }
        let healthy = try SecureCredentialStore(directory: directory)
        let initial = try await healthy.initializeProfileState(commitID: UUID().uuidString, expectedStoreRevision: 0, profiles: [])
        let oldBytes = try Data(contentsOf: directory.appendingPathComponent("credentials.json"))
        let failing = try SecureCredentialStore(directory: directory, fault: { $0 == stage })
        let input = secureStoreInput(revision: initial.storeRevision)
        try await expectSecureStoreFailure("injected persistence failure must not report success") { _ = try await failing.saveProfile(input, value: Data()) }
        let renamed = [.afterRename, .beforeDirectoryFsync, .beforeReadback].contains(stage)
        if renamed {
            let current = try await healthy.readProfileState()
            try check(current.lastCommit?.commitId == input.commitID, "rename uncertainty must preserve the latest committed candidate")
            if stage == .beforeDirectoryFsync {
                try await expectSecureStoreFailure("receipt readback alone must not skip required directory synchronization") { _ = try await failing.saveProfile(input, value: Data()) }
            }
            let confirmed = try await healthy.saveProfile(input, value: Data())
            try check(confirmed.storeRevision == initial.storeRevision + 1, "reconciliation must confirm without duplicating a commit")
        } else {
            let currentBytes = try Data(contentsOf: directory.appendingPathComponent("credentials.json"))
            try check(currentBytes == oldBytes, "pre-rename failure must preserve the exact old snapshot")
        }
        let files = try FileManager.default.contentsOfDirectory(atPath: directory.path)
        try check(!files.contains(where: { $0.hasPrefix(".credentials-v2-") && $0.hasSuffix(".tmp") }), "failed in-process transaction must remove only its own temporary file")
    }
}

private func secureStorePreservesOpaqueEntries() async throws {
    let directory = try secureStoreDirectory()
    defer { try? FileManager.default.removeItem(at: directory) }
    let store = try SecureCredentialStore(directory: directory, protection: CredentialProtection(backend: DeniedKeyBackend()))
    let initial = try await store.initializeProfileState(commitID: UUID().uuidString, expectedStoreRevision: 0, profiles: [secureStoreProfile(), secureStoreProfile(secureStoreOtherID)])
    var document = try secureStoreDocument(directory)
    let opaque = ["credentialId": UUID().uuidString, "envelope": "damaged opaque envelope"]
    let slotID = UUID().uuidString
    let slot = ["keyId": slotID, "wrappedRepresentation": "damaged opaque hardware material"]
    document["credentials"] = [secureStoreProfileID: opaque, secureStoreOtherID: opaque]
    document["keyRing"] = [slotID: slot]
    try writeSecureStoreDocument(document, directory: directory)
    let list = try await store.readProfileState()
    try check(list.profileState?.profiles.count == 2 && list.credentialConfigured.values.allSatisfy { $0 }, "opaque corruption must preserve profiles and configured presence")
    try await expectSecureStoreFailure("opaque corruption must fail native credential use") { _ = try await store.readCredential(profileID: secureStoreProfileID, expectedProfileRevision: 1) }
    let input = secureStoreInput(revision: initial.storeRevision, profileRevision: 1, profiles: [secureStoreProfile(revision: 2), secureStoreProfile(secureStoreOtherID)])
    _ = try await store.saveProfile(input, value: Data())
    let result = try secureStoreDocument(directory)
    let credentials = result["credentials"] as! [String: [String: String]]
    try check(credentials[secureStoreProfileID] == nil && credentials[secureStoreOtherID] == opaque, "clearing one damaged record must preserve other opaque bytes")
    try check((result["keyRing"] as? [String: [String: String]])?[slotID] == slot, "uninterpretable key dependencies must be retained")
}

private func secureStoreRejectsDamagedDocuments() async throws {
    for bytes in [Data("{".utf8), Data("{\"formatVersion\":999,\"credentials\":{}}".utf8), Data("{\"formatVersion\":2,\"credentials\":{},\"storeRevision\":0}".utf8)] {
        let directory = try secureStoreDirectory()
        defer { try? FileManager.default.removeItem(at: directory) }
        let file = directory.appendingPathComponent("credentials.json")
        try bytes.write(to: file)
        let store = try SecureCredentialStore(directory: directory)
        try await expectSecureStoreFailure("damaged storage must not be treated as absent") { _ = try await store.initializeProfileState(commitID: UUID().uuidString, expectedStoreRevision: 0, profiles: []) }
        let after = try Data(contentsOf: file)
        try check(after == bytes, "damaged main document must remain available for recovery")
    }
}

private func secureStoreCompareAndSwap() async throws {
    let directory = try secureStoreDirectory()
    defer { try? FileManager.default.removeItem(at: directory) }
    let first = try SecureCredentialStore(directory: directory)
    let second = try SecureCredentialStore(directory: directory)
    let initial = try await first.initializeProfileState(commitID: UUID().uuidString, expectedStoreRevision: 0, profiles: [])
    let left = secureStoreInput(revision: initial.storeRevision)
    let right = secureStoreInput(revision: initial.storeRevision)
    async let result1: Bool = attemptSecureSave(first, left)
    async let result2: Bool = attemptSecureSave(second, right)
    let results = await [result1, result2]
    try check(results.filter { $0 }.count == 1, "two authorities sharing a fixed lock must have exactly one CAS winner")
}

private func attemptSecureSave(_ store: SecureCredentialStore, _ input: CredentialProfileSave) async -> Bool {
    do { _ = try await store.saveProfile(input, value: Data()); return true }
    catch { return false }
}

private func secureStoreProtocolSave() async throws {
    let directory = try secureStoreDirectory()
    defer { try? FileManager.default.removeItem(at: directory) }
    let store = try SecureCredentialStore(directory: directory, protection: CredentialProtection(backend: SyntheticKeyBackend()))
    _ = try await store.initializeProfileState(commitID: UUID().uuidString, expectedStoreRevision: 0, profiles: [])
    let handler = ProtocolHandler(token: "synthetic-token", credentialStore: store)
    let owner: [String: Any] = ["sidebarInstanceId": "save-sidebar", "senderId": "save-window", "drawerId": "save-drawer"]
    let local = P256.KeyAgreement.PrivateKey()
    var opening = owner
    opening["protocolVersion"] = 2
    opening["sourceProfile"] = NSNull()
    opening["clientPublicKey"] = local.publicKey.x963Representation.base64EncodedString()
    let offered = await handler.handle(path: "/v2/credential-channel", authorization: "Bearer synthetic-token", body: try JSONSerialization.data(withJSONObject: ["action": "open", "payload": opening]))
    try check(offered.statusCode == 200, "Save must open an authenticated channel")
    let raw = try JSONSerialization.jsonObject(with: offered.body) as! [String: Any]
    let offer = CredentialChannelOffer(owner: CredentialChannelOwner(sidebarInstanceID: "save-sidebar", senderID: "save-window", drawerID: "save-drawer"), helperSessionID: raw["helperSessionId"] as! String, channelID: raw["channelId"] as! String, source: nil, clientPublicKey: local.publicKey.x963Representation, helperPublicKey: try CredentialWire.base64(raw["helperPublicKey"], maximum: 65), salt: try CredentialWire.base64(raw["salt"], maximum: 32))
    let key = try CredentialCryptography.derive(privateKey: local.rawRepresentation, publicKey: offer.helperPublicKey, salt: offer.salt, info: offer.keyInfo("sidebar-to-helper"))
    let confirmation: [String: Any] = ["protocolVersion": 2, "channelId": offer.channelID, "helperSessionId": offer.helperSessionID, "sequence": 0, "sealedPayload": try CredentialCryptography.seal(key: key, nonce: CredentialWire.nonce(0), value: Data(), aad: offer.handshakeAAD("sidebar-to-helper")).base64EncodedString()]
    let confirmed = await handler.handle(path: "/v2/credential-channel", authorization: "Bearer synthetic-token", body: try JSONSerialization.data(withJSONObject: ["action": "confirm", "payload": ["owner": owner, "frame": confirmation]]))
    try check(confirmed.statusCode == 200, "Save channel must confirm")
    let profile = secureStoreProfile()
    let state = StoredProfileState(profiles: [profile], activation: nil)
    let commitID = UUID().uuidString
    let bytes = try JSONSerialization.data(withJSONObject: ["kind": profile.kind, "endpoint": profile.endpoint, "model": profile.model!, "proxyMode": profile.proxyMode!, "purpose": "save-profile", "sourceProfile": NSNull(), "save": ["commitId": commitID, "expectedStoreRevision": 1, "expectedProfileRevision": NSNull(), "profileState": JSONSerialization.jsonObject(with: JSONEncoder().encode(state))]])
    let context = try CredentialContext(["requestId": "save-request", "draftRevision": 0, "keyEditEpoch": 0, "submitEpoch": 1, "purpose": "save-profile", "sourceProfile": NSNull(), "kind": profile.kind, "endpointFingerprint": profile.endpointFingerprint, "snapshotDigest": CredentialCryptography.digest(bytes), "expiresAtMs": Int64(Date().timeIntervalSince1970 * 1000) + 60000])
    let value = Data("synthetic-protocol-save".utf8)
    var frame: [String: Any] = ["protocolVersion": 2, "channelId": offer.channelID, "helperSessionId": offer.helperSessionID, "sequence": 1, "context": context.object, "snapshotBytes": bytes.base64EncodedString(), "sealedPayload": try CredentialCryptography.seal(key: key, nonce: CredentialWire.nonce(1), value: value, aad: context.aad(offer: offer, direction: "sidebar-to-helper", sequence: 1)).base64EncodedString()]
    let body = try JSONSerialization.data(withJSONObject: ["action": "save", "owner": owner, "frame": frame])
    let saved = await handler.handle(path: "/v2/profile-state", authorization: "Bearer synthetic-token", body: body)
    try check(saved.statusCode == 200, "sealed Profile Save must commit through the production protocol")
    let loaded = try await store.readCredential(profileID: profile.profileId, expectedProfileRevision: 1)
    try check(loaded == value, "protocol Save must bind the decrypted value to the candidate Profile")
    let restarted = ProtocolHandler(token: "synthetic-token", credentialStore: try SecureCredentialStore(directory: directory, protection: CredentialProtection(backend: DeniedKeyBackend())))
    let retry = await restarted.handle(path: "/v2/profile-state", authorization: "Bearer synthetic-token", body: body)
    try check(retry.statusCode == 200 && retry.body == saved.body, "exact receipt must confirm before the old helper channel or hardware is consulted")
    frame["sealedPayload"] = Data(repeating: 0, count: 32).base64EncodedString()
    let changed = await restarted.handle(path: "/v2/profile-state", authorization: "Bearer synthetic-token", body: try JSONSerialization.data(withJSONObject: ["action": "save", "owner": owner, "frame": frame]))
    try check(changed.statusCode == 409, "same commit with changed ciphertext must conflict")
    let legacy = await handler.handle(path: "/v2/credentials", authorization: "Bearer synthetic-token", body: try JSONSerialization.data(withJSONObject: ["action": "read", "profileId": profile.profileId]))
    try check(legacy.statusCode == 404, "plaintext credential RPC must be absent")
    _ = try await store.openProfileState(commitID: UUID().uuidString)
    let superseded = await restarted.handle(path: "/v2/profile-state", authorization: "Bearer synthetic-token", body: body)
    try check(superseded.statusCode == 409, "a later commit must prevent historical receipt confirmation")
}
