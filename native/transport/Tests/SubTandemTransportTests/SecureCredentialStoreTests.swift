import CryptoKit
import Darwin
import Foundation

private let secureStoreProfileID = "10000000-0000-4000-8000-000000000001"
private let secureStoreOtherID = "10000000-0000-4000-8000-000000000002"

private func secureStoreProfile(_ id: String = secureStoreProfileID, revision: Int = 1) -> StoredProviderProfile {
    StoredProviderProfile(profileId: id, revision: revision, displayName: "Synthetic", kind: "openai", endpoint: "https://example.test", endpointFingerprint: "77e6ddaebd4c56f3f66bb6ff4c788c4b4b5057a5410534047a17146c2daf1807", proxyMode: "direct", model: "synthetic-model", capability: nil)
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
    try await secureStoreRecoveryMatrix()
    try await secureStoreRecoveryFailures()
    try await secureStoreIndependentCredentialProjection()
    try await secureStoreProtocolSave()
    try await secureStoreInitializesV2()
    try await secureStoreAtomicSaveAndReceipt()
    try await secureStoreFailureMatrix()
    try await secureStorePreservesOpaqueEntries()
    try await secureStoreRejectsDamagedDocuments()
    try await secureStoreCompareAndSwap()
    try await secureStoreCrossProcessLock()
}

private func secureStoreRecoveryMatrix() async throws {
    for fault in ["missing", "empty", "truncated", "unsupported", "configuration"] {
        let directory = try secureStoreDirectory()
        defer { try? FileManager.default.removeItem(at: directory) }
        let file = directory.appendingPathComponent("credentials.json")
        if fault != "missing" {
            let content = fault == "empty" ? "" : fault == "truncated" ? "{" : fault == "unsupported" ? "{\"formatVersion\":9}" : "{\"formatVersion\":2,\"profileState\":{\"profiles\":[]}}"
            try Data(content.utf8).write(to: file)
            chmod(file.path, 0o600)
        }
        let store = try SecureCredentialStore(directory: directory)
        let handler = ProtocolHandler(token: "recovery-token", credentialStore: store)
        let commitID = UUID().uuidString.lowercased()
        let request: [String: Any] = ["action": "recover", "commitId": commitID, "expiresAtMs": Int64(Date().timeIntervalSince1970 * 1000) + 10000]
        let body = try JSONSerialization.data(withJSONObject: request)
        let response = await handler.handle(path: "/v2/profile-state", authorization: "Bearer recovery-token", body: body)
        try check(response.statusCode == 200, "safe non-sensitive list corruption must recover through the authenticated production interface")
        let result = try JSONSerialization.jsonObject(with: response.body) as! [String: Any]
        try check(result["recovery"] as? String == (fault == "missing" ? "initialized" : "reset"), "recovery must report its real persistence outcome")
        let document = try secureStoreDocument(directory)
        try check(document["storeRevision"] as? Int == 1 && (document["lastCommit"] as? [String: Any])?["operation"] as? String == "recover", "recovery must create a real versioned receipt")
        let before = try Data(contentsOf: file)
        let retry = await handler.handle(path: "/v2/profile-state", authorization: "Bearer recovery-token", body: body)
        let after = try Data(contentsOf: file)
        try check(retry.statusCode == 200 && before == after, "the same commit must confirm instead of clearing twice")
        _ = try await store.saveProfile(secureStoreInput(revision: 1), value: Data())
        let retained = await handler.handle(path: "/v2/profile-state", authorization: "Bearer recovery-token", body: body)
        let read = try await store.readProfileState()
        try check(retained.statusCode == 200 && read.profileState?.profiles.count == 1, "a subsequent commit must survive a stale recovery request")
        for invalid in ["path", "profiles", "apiKey", "expectedStoreRevision"] {
            var extra = request
            extra[invalid] = "forbidden"
            let rejected = await handler.handle(path: "/v2/profile-state", authorization: "Bearer recovery-token", body: try JSONSerialization.data(withJSONObject: extra))
            try check(rejected.statusCode == 400, "recovery must reject extra client supplied data")
        }
    }
}

private func secureStoreRecoveryFailures() async throws {
    for stage: CredentialPersistStage in [.beforeWrite, .beforeFsync, .beforeRename, .afterRename, .beforeDirectoryFsync, .beforeReadback] {
        let directory = try secureStoreDirectory()
        defer { try? FileManager.default.removeItem(at: directory) }
        let file = directory.appendingPathComponent("credentials.json")
        let original = Data("{synthetic-damaged-list".utf8)
        try original.write(to: file)
        chmod(file.path, 0o600)
        let failing = try SecureCredentialStore(directory: directory, fault: { $0 == stage })
        let commitID = UUID().uuidString
        let deadline = Int64(Date().timeIntervalSince1970 * 1000) + 10000
        try await expectSecureStoreFailure("recovery persistence faults must never report committed") { _ = try await failing.recoverProfileState(commitID: commitID, expiresAtMs: deadline) }
        let renamed = [.afterRename, .beforeDirectoryFsync, .beforeReadback].contains(stage)
        let bytes = try Data(contentsOf: file)
        if renamed {
            let healthy = try SecureCredentialStore(directory: directory)
            let confirmed = try await healthy.recoverProfileState(commitID: commitID, expiresAtMs: 0)
            try check(confirmed.storeRevision == 1 && confirmed.lastCommit?.commitId == commitID, "expired retries may only confirm the existing atomic receipt")
            let confirmedBytes = try Data(contentsOf: file)
            try check(confirmedBytes == bytes, "receipt confirmation cannot reset or rewrite the document")
            if stage == .beforeDirectoryFsync {
                try await expectSecureStoreFailure("confirmation requires directory synchronization") { _ = try await failing.recoverProfileState(commitID: commitID, expiresAtMs: deadline) }
            }
        } else { try check(bytes == original, "pre-rename recovery failure must preserve exact original bytes") }
        let entries = try FileManager.default.contentsOfDirectory(atPath: directory.path)
        try check(entries.sorted() == [".credentials.lock", "credentials.json"], "recovery must not leave temporary files, plaintext copies or backups")
    }
    for unsafe in ["symlink", "hardlink", "permissions", "oversize", "expired", "lock"] {
        let directory = try secureStoreDirectory()
        defer { try? FileManager.default.removeItem(at: directory) }
        let file = directory.appendingPathComponent("credentials.json")
        let outside = directory.appendingPathComponent("external")
        let original = Data("{unsafe-list".utf8)
        try original.write(to: file)
        chmod(file.path, 0o600)
        if unsafe == "symlink" {
            try FileManager.default.moveItem(at: file, to: outside)
            try FileManager.default.createSymbolicLink(atPath: file.path, withDestinationPath: outside.path)
        }
        if unsafe == "hardlink" { try FileManager.default.linkItem(at: file, to: outside) }
        if unsafe == "permissions" { chmod(file.path, 0o400) }
        if unsafe == "oversize" { try Data(repeating: 0, count: 1_048_577).write(to: file) }
        let before = try Data(contentsOf: file)
        let store = try SecureCredentialStore(directory: directory)
        let lock = open(directory.appendingPathComponent(".credentials.lock").path, O_RDWR)
        defer { close(lock) }
        if unsafe == "lock" { try check(flock(lock, LOCK_EX | LOCK_NB) == 0, "test lock must be held") }
        let deadline = Int64(Date().timeIntervalSince1970 * 1000) + (unsafe == "expired" ? -1 : unsafe == "lock" ? 30 : 1000)
        let started = Date()
        try await expectSecureStoreFailure("inaccessible or expired recovery must fail without writing") { _ = try await store.recoverProfileState(commitID: UUID().uuidString, expiresAtMs: deadline) }
        if unsafe == "lock" { flock(lock, LOCK_UN); try check(Date().timeIntervalSince(started) < 1, "busy fixed locks must respect the total budget") }
        let preservedBytes = try Data(contentsOf: file)
        try check(preservedBytes == before, "unsafe recovery must preserve bytes")
        if unsafe == "permissions" { let attributes = try FileManager.default.attributesOfItem(atPath: file.path); try check((attributes[.posixPermissions] as? NSNumber)?.intValue == 0o400, "recovery cannot expand permissions") }
    }
    for point in ["beforeRename", "afterRename"] {
        let directory = try secureStoreDirectory()
        defer { try? FileManager.default.removeItem(at: directory) }
        let file = directory.appendingPathComponent("credentials.json")
        let original = Data("{interrupted-list".utf8)
        try original.write(to: file)
        chmod(file.path, 0o600)
        let child = Process()
        child.executableURL = URL(fileURLWithPath: CommandLine.arguments[0])
        var environment = ProcessInfo.processInfo.environment
        environment["SUBTANDEM_NATIVE_TEST"] = "credential-store-worker"
        environment["SUBTANDEM_STORE_TEST_DIRECTORY"] = directory.path
        environment["SUBTANDEM_STORE_TEST_INTERRUPT"] = point
        child.environment = environment
        try child.run()
        try Data().write(to: directory.appendingPathComponent("start-workers"))
        child.waitUntilExit()
        try check(child.terminationStatus == 23, "worker must interrupt at the production atomic boundary")
        let bytes = try Data(contentsOf: file)
        if point == "beforeRename" { try check(bytes == original, "interruption before rename preserves the old target") }
        else { let document = try secureStoreDocument(directory); try check(document["storeRevision"] as? Int == 1, "interruption after rename leaves an intact atomic document") }
        let reopened = try SecureCredentialStore(directory: directory)
        let recovered = try await reopened.recoverProfileState(commitID: UUID().uuidString, expiresAtMs: Int64(Date().timeIntervalSince1970 * 1000) + 10000)
        try check(recovered.storeRevision == 1 && recovered.profileState?.profiles.isEmpty == true, "a restarted process can verify or safely finish interrupted recovery")
        let entries = try FileManager.default.contentsOfDirectory(atPath: directory.path)
        try check(!entries.contains(where: { $0.contains("backup") || $0.contains("corrupt") }), "interrupted recovery cannot create restoration copies")
    }
    let directory = try secureStoreDirectory()
    defer { try? FileManager.default.removeItem(at: directory) }
    let store = try SecureCredentialStore(directory: directory)
    var children: [Process] = []
    for _ in 0..<2 {
        let child = Process()
        child.executableURL = URL(fileURLWithPath: CommandLine.arguments[0])
        var environment = ProcessInfo.processInfo.environment
        environment["SUBTANDEM_NATIVE_TEST"] = "credential-store-worker"
        environment["SUBTANDEM_STORE_TEST_DIRECTORY"] = directory.path
        environment["SUBTANDEM_STORE_TEST_RECOVER"] = "1"
        child.environment = environment
        try child.run()
        children.append(child)
    }
    defer { for child in children where child.isRunning { child.terminate() } }
    try Data().write(to: directory.appendingPathComponent("start-workers"))
    for child in children { child.waitUntilExit() }
    try check(children.map(\.terminationStatus).sorted() == [0, 17], "two processes must recheck recovery under the lock and preserve one later save")
    let snapshot = try await store.readProfileState()
    try check(snapshot.storeRevision == 2 && snapshot.profileState?.profiles.count == 1, "concurrent recovery must never clear a competing committed profile")
}

private func secureStoreIndependentCredentialProjection() async throws {
    for failure in ["credentials-container", "credential-record", "keyRing-container", "keyRing-record", "activation-structure", "activation-association"] {
        let directory = try secureStoreDirectory()
        defer { try? FileManager.default.removeItem(at: directory) }
        let store = try SecureCredentialStore(directory: directory, protection: CredentialProtection(backend: SyntheticKeyBackend()))
        _ = try await store.initializeProfileState(commitID: UUID().uuidString, expectedStoreRevision: 0, profiles: [])
        _ = try await store.saveProfile(secureStoreInput(revision: 1), value: Data("synthetic-projection-key".utf8))
        let activation = StoredActivationReference(profileId: secureStoreProfileID, profileRevision: 1, kind: "openai", endpointFingerprint: secureStoreProfile().endpointFingerprint, credentialConfigured: true)
        _ = try await store.commitProfileState(commitID: UUID().uuidString, expectedStoreRevision: 2, profileState: StoredProfileState(profiles: [secureStoreProfile()], activation: activation))
        var object = try secureStoreDocument(directory)
        if failure == "credentials-container" { object["credentials"] = "broken" }
        if failure == "credential-record" { object["credentials"] = [secureStoreProfileID: ["apiKey": "unsafe-old-plaintext"]] }
        if failure == "keyRing-container" { object["keyRing"] = 7 }
        if failure == "keyRing-record" { object["keyRing"] = [UUID().uuidString: ["broken": true]] }
        if failure.hasPrefix("activation-") {
            var state = object["profileState"] as! [String: Any]
            state["activation"] = failure == "activation-structure" ? "broken" : ["profileId": secureStoreOtherID, "profileRevision": 1, "kind": "openai", "endpointFingerprint": "wrong", "credentialConfigured": true] as [String: Any]
            object["profileState"] = state
        }
        try writeSecureStoreDocument(object, directory: directory)
        let original = try Data(contentsOf: directory.appendingPathComponent("credentials.json"))
        let read = try await store.readProfileState()
        try check(read.profileState?.profiles == [secureStoreProfile()], "credential or activation damage must retain the complete non-sensitive list")
        try check(read.credentialConfigured[secureStoreProfileID] == true, "unknown credential presence must not be projected as absent")
        try check(read.profileState?.activation == (failure.hasPrefix("activation-") ? nil : activation), "only invalid activation may be removed from the projection")
        let recovery = try await store.recoverProfileState(commitID: UUID().uuidString, expiresAtMs: Int64(Date().timeIntervalSince1970 * 1000) + 10000)
        try check(recovery.recovery == "retained" && recovery.profileState?.profiles == [secureStoreProfile()], "credential and activation failures must never trigger whole-list reset")
        let after = try Data(contentsOf: directory.appendingPathComponent("credentials.json"))
        try check(after == original, "v2 failure projection must not change persistent bytes")
        if failure.hasPrefix("credential") {
            try await expectSecureStoreFailure("uninterpretable credentials must fail instead of returning nil") { _ = try await store.readCredential(profileID: secureStoreProfileID, expectedProfileRevision: 1) }
        }
    }
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
    if let point = environment["SUBTANDEM_STORE_TEST_INTERRUPT"] {
        let crashing = try SecureCredentialStore(directory: directory, fault: { stage in
            if (point == "beforeRename" && stage == .beforeRename) || (point == "afterRename" && stage == .afterRename) { _exit(23) }
            return false
        })
        _ = try await crashing.recoverProfileState(commitID: UUID().uuidString, expiresAtMs: Int64(Date().timeIntervalSince1970 * 1000) + 10000)
        throw ContractTestFailure(description: "worker did not interrupt")
    }
    do {
        if environment["SUBTANDEM_STORE_TEST_RECOVER"] == "1" { _ = try await store.recoverProfileState(commitID: UUID().uuidString, expiresAtMs: Int64(Date().timeIntervalSince1970 * 1000) + 10000) }
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
