import Darwin
import Foundation

private let migrationID = "10000000-0000-4000-8000-000000000001"
private let migrationOldKey = "synthetic-migration-old-key"

private func migrationProfile(revision: Int = 3) -> StoredProviderProfile {
    StoredProviderProfile(profileId: migrationID, revision: revision, displayName: "Retained", kind: "openai", endpoint: "https://example.test/v1", endpointFingerprint: "0d60715773b0025a549a09f48db8f58ac0f08cd3fb973bf8eca151f51a7eb4d8", proxyMode: "direct", model: "model-a", capability: nil)
}

private func migrationFixture(_ directory: URL, profileState: Bool = true) throws -> Data {
    var object: [String: Any] = ["formatVersion": 1, "storeRevision": 7, "credentials": [migrationID: ["apiKey": migrationOldKey]]]
    if profileState {
        let state = StoredProfileState(profiles: [migrationProfile()], activation: StoredActivationReference(profileId: migrationID, profileRevision: 3, kind: "openai", endpointFingerprint: migrationProfile().endpointFingerprint, credentialConfigured: true))
        object["profileState"] = try JSONSerialization.jsonObject(with: JSONEncoder().encode(state))
    }
    let data = try JSONSerialization.data(withJSONObject: object, options: [.sortedKeys])
    try data.write(to: directory.appendingPathComponent("credentials.json"))
    return data
}

private func migrationDirectories() throws -> (URL, URL) {
    let root = FileManager.default.temporaryDirectory.appendingPathComponent("subtandem-migration-\(UUID().uuidString)")
    let data = root.appendingPathComponent("data")
    let mailbox = root.appendingPathComponent("mailbox")
    try FileManager.default.createDirectory(at: data, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
    try FileManager.default.createDirectory(at: mailbox, withIntermediateDirectories: false, attributes: [.posixPermissions: 0o700])
    let preference = migrationPreferenceFile(data)
    try FileManager.default.createDirectory(at: preference.deletingLastPathComponent(), withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
    try PropertyListSerialization.data(fromPropertyList: ["providerProfilesJson": ""], format: .xml, options: 0).write(to: preference)
    return (data, mailbox)
}

private func migrationPreferenceFile(_ directory: URL) -> URL {
    if directory.deletingLastPathComponent().lastPathComponent == ".data" {
        return directory.deletingLastPathComponent().deletingLastPathComponent().appendingPathComponent(".preferences/\(directory.lastPathComponent).plist")
    }
    return directory.deletingLastPathComponent().appendingPathComponent("preferences/config.plist")
}

private func migrationDocument(_ directory: URL) throws -> [String: Any] {
    try JSONSerialization.jsonObject(with: Data(contentsOf: directory.appendingPathComponent("credentials.json"))) as! [String: Any]
}

func runCredentialMigrationTests() async throws {
    let (directory, mailbox) = try migrationDirectories()
    defer { try? FileManager.default.removeItem(at: directory.deletingLastPathComponent()) }
    _ = try migrationFixture(directory)
    let store = try SecureCredentialStore(directory: directory, mailboxDirectory: mailbox, preferenceFile: migrationPreferenceFile(directory))
    let migrated = try await store.migrateProfileState(commitID: UUID().uuidString, profiles: nil)
    try check(migrated.profileState?.profiles == [migrationProfile()], "migration must retain every stable ID, revision and profile field")
    try check(migrated.profileState?.activation?.profileId == migrationID && migrated.profileState?.activation?.credentialConfigured == false, "migration must preserve a valid activation while clearing configured")
    try check(migrated.credentialConfigured[migrationID] == false && migrated.migration?.cleanupState == "pending", "migration must clear credentials before cleanup")
    let committed = try Data(contentsOf: directory.appendingPathComponent("credentials.json"))
    try check(!String(decoding: committed, as: UTF8.self).contains(migrationOldKey), "migration must never serialize the old key")
    let document = try migrationDocument(directory)
    try check((document["credentials"] as? [String: Any])?.isEmpty == true && (document["keyRing"] as? [String: Any])?.isEmpty == true, "migration must not encrypt or import old credentials")
    try check(migrated.storeRevision == 8 && migrated.lastCommit?.operation == "migrate", "migration must atomically commit its receipt and metadata")
    let clean = try await store.cleanupProfileState(commitID: UUID().uuidString, migrationID: migrated.migration!.migrationId, preferenceConfirmed: true)
    try check(clean.migration?.cleanupState == "clean", "all confirmed cleanup classes must become clean")
    try await migrationOnlyCredentials()
    try await migrationCommitFaults()
    try await migrationCleanupMatrix()
    try await migrationPreservesNewValue()
    try await migrationPreferenceReadback()
    try await migrationUnsafePathsAndDocuments()
    try await migrationProcessExitMatrix()
    try await migrationStopsOnlyLegacyWriter()
}

private func migrationPreferenceReadback() async throws {
    let (directory, mailbox) = try migrationDirectories()
    defer { try? FileManager.default.removeItem(at: directory.deletingLastPathComponent()) }
    _ = try migrationFixture(directory)
    let preference = migrationPreferenceFile(directory)
    let store = try SecureCredentialStore(directory: directory, mailboxDirectory: mailbox, preferenceFile: preference)
    let migrated = try await store.migrateProfileState(commitID: UUID().uuidString, profiles: nil)
    try PropertyListSerialization.data(fromPropertyList: ["providerProfilesJson": migrationOldKey, "enabledByDefault": true], format: .binary, options: 0).write(to: preference)
    let pending = try await store.cleanupProfileState(commitID: UUID().uuidString, migrationID: migrated.migration!.migrationId, preferenceConfirmed: true)
    try check(pending.migration?.pendingClasses == ["legacy-preferences"], "in-memory confirmation must not conceal a persisted old preference")
    try Data("damaged plist".utf8).write(to: preference)
    let damaged = try await store.cleanupProfileState(commitID: UUID().uuidString, migrationID: migrated.migration!.migrationId, preferenceConfirmed: true)
    try check(damaged.migration?.cleanupState == "pending", "unreadable persisted preferences must keep cleanup pending")
    try PropertyListSerialization.data(fromPropertyList: ["providerProfilesJson": "", "enabledByDefault": true], format: .binary, options: 0).write(to: preference)
    let clean = try await store.cleanupProfileState(commitID: UUID().uuidString, migrationID: migrated.migration!.migrationId, preferenceConfirmed: true)
    try check(clean.migration?.cleanupState == "clean", "cleanup must confirm the durable blank preference and preserve unrelated values")
    let values = try PropertyListSerialization.propertyList(from: Data(contentsOf: preference), format: nil) as! [String: Any]
    try check(values["enabledByDefault"] as? Bool == true, "preference cleanup must not rewrite unrelated settings")
}

func runCredentialMigrationWorker() async throws {
    let environment = ProcessInfo.processInfo.environment
    let directory = URL(fileURLWithPath: environment["SUBTANDEM_MIGRATION_DIRECTORY"]!)
    let mailbox = URL(fileURLWithPath: environment["SUBTANDEM_MIGRATION_MAILBOX"]!)
    let selected = environment["SUBTANDEM_MIGRATION_FAULT_PATH"]
    let store = try SecureCredentialStore(directory: directory, mailboxDirectory: mailbox, preferenceFile: migrationPreferenceFile(directory), cleanupFault: { point, path in
        if String(describing: point) == environment["SUBTANDEM_MIGRATION_FAULT"] && (selected == nil || selected == path) { exit(77) }
        return false
    })
    _ = try await store.cleanupProfileState(commitID: UUID().uuidString, migrationID: environment["SUBTANDEM_MIGRATION_ID"]!, preferenceConfirmed: true)
}

func runCredentialMigrationWriter() async throws {
    let environment = ProcessInfo.processInfo.environment
    let directory = URL(fileURLWithPath: environment["SUBTANDEM_MIGRATION_WRITER_DIRECTORY"]!)
    let name = environment["SUBTANDEM_MIGRATION_WRITER_NAME"]!
    while true {
        try Data(migrationOldKey.utf8).write(to: directory.appendingPathComponent(name))
        try await Task.sleep(nanoseconds: 10_000_000)
    }
}

private func migrationProcessExitMatrix() async throws {
    for stage in CredentialCleanupStage.allCases {
        let scopes = [.beforeDirectoryFsync, .afterDirectoryFsync].contains(stage) ? ["data", "rpc", "session", "mailbox", "parent", "preferences"] : ["all"]
        for scope in scopes {
            let (directory, mailbox) = try migrationDirectories()
            defer { try? FileManager.default.removeItem(at: directory.deletingLastPathComponent()) }
            _ = try migrationFixture(directory)
            let targets = try managedMigrationFiles(directory, mailbox)
            let store = try SecureCredentialStore(directory: directory, mailboxDirectory: mailbox, preferenceFile: migrationPreferenceFile(directory))
            let migrated = try await store.migrateProfileState(commitID: UUID().uuidString, profiles: nil)
            let selected = ["data": directory, "rpc": directory.appendingPathComponent(".rpc"), "session": directory.appendingPathComponent(".rpc/transport-old-1-abc"), "mailbox": mailbox, "parent": mailbox.deletingLastPathComponent(), "preferences": migrationPreferenceFile(directory).deletingLastPathComponent()][scope]?.path
            let child = Process()
            child.executableURL = URL(fileURLWithPath: CommandLine.arguments[0])
            var environment = ProcessInfo.processInfo.environment
            environment["SUBTANDEM_NATIVE_TEST"] = "credential-migration-worker"
            environment["SUBTANDEM_MIGRATION_DIRECTORY"] = directory.path
            environment["SUBTANDEM_MIGRATION_MAILBOX"] = mailbox.path
            environment["SUBTANDEM_MIGRATION_ID"] = migrated.migration!.migrationId
            environment["SUBTANDEM_MIGRATION_FAULT"] = String(describing: stage)
            environment["SUBTANDEM_MIGRATION_FAULT_PATH"] = selected
            child.environment = environment
            try child.run()
            child.waitUntilExit()
            try check(child.terminationStatus == 77, "each cleanup point must be reached in an actual exiting child process")
            let restarted = try SecureCredentialStore(directory: directory, mailboxDirectory: mailbox, preferenceFile: migrationPreferenceFile(directory))
            let recovered = try await restarted.cleanupProfileState(commitID: UUID().uuidString, migrationID: migrated.migration!.migrationId, preferenceConfirmed: true)
            try check(recovered.migration?.cleanupState == "clean" && targets.allSatisfy { !FileManager.default.fileExists(atPath: $0.path) }, "restart after process exit must finish deletions and all required directory syncs")
        }
    }
}

private func migrationStopsOnlyLegacyWriter() async throws {
    let root = FileManager.default.temporaryDirectory.appendingPathComponent("subtandem-migration-writers-\(UUID().uuidString)")
    let directory = root.appendingPathComponent("plugins/.data/io.subtandem.iina")
    let mailbox = root.appendingPathComponent("mailbox")
    let executable = root.appendingPathComponent("plugins/io.subtandem.iina.iinaplugin/dist/native/subtandem-transport")
    try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
    try FileManager.default.createDirectory(at: mailbox, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
    try FileManager.default.createDirectory(at: executable.deletingLastPathComponent(), withIntermediateDirectories: true)
    try FileManager.default.copyItem(at: URL(fileURLWithPath: CommandLine.arguments[0]), to: executable)
    try FileManager.default.setAttributes([.posixPermissions: 0o755], ofItemAtPath: executable.path)
    let preference = migrationPreferenceFile(directory)
    try FileManager.default.createDirectory(at: preference.deletingLastPathComponent(), withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
    try PropertyListSerialization.data(fromPropertyList: ["providerProfilesJson": ""], format: .xml, options: 0).write(to: preference)
    _ = try migrationFixture(directory)
    var children: [Process] = []
    defer { for child in children where child.isRunning { child.terminate(); child.waitUntilExit() }; try? FileManager.default.removeItem(at: root) }
    for legacy in [true, false] {
        let session = legacy ? "old-1-abc" : "new-1-abc"
        let rpc = directory.appendingPathComponent(".rpc/transport-\(legacy ? "" : "v2-")\(session)")
        try FileManager.default.createDirectory(at: rpc, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
        let child = Process()
        child.executableURL = executable
        child.arguments = ["serve", "--data-directory", directory.path, "--ready-file", directory.appendingPathComponent(".ready/transport-\(session).json").path, "--rpc-session", session, "--parent-pid", String(getpid())]
        var environment = ProcessInfo.processInfo.environment
        environment["SUBTANDEM_NATIVE_TEST"] = "credential-migration-writer"
        environment["SUBTANDEM_MIGRATION_WRITER_DIRECTORY"] = rpc.path
        environment["SUBTANDEM_MIGRATION_WRITER_NAME"] = "transport-\(legacy ? "" : "v2-")a-1-abc.request.json"
        child.environment = environment
        try child.run()
        children.append(child)
        for _ in 0..<200 {
            if FileManager.default.fileExists(atPath: rpc.appendingPathComponent(environment["SUBTANDEM_MIGRATION_WRITER_NAME"]!).path) { break }
            try await Task.sleep(nanoseconds: 10_000_000)
        }
    }
    let store = try SecureCredentialStore(directory: directory, mailboxDirectory: mailbox, preferenceFile: migrationPreferenceFile(directory))
    let migrated = try await store.migrateProfileState(commitID: UUID().uuidString, profiles: nil)
    let clean = try await store.cleanupProfileState(commitID: UUID().uuidString, migrationID: migrated.migration!.migrationId, preferenceConfirmed: true)
    try check(clean.migration?.cleanupState == "clean", "legacy writer retirement must allow managed cleanup")
    children[0].waitUntilExit()
    try check(children[0].terminationReason == .uncaughtSignal && children[1].isRunning, "only the identified legacy helper may be terminated")
    try await Task.sleep(nanoseconds: 50_000_000)
    try check(!FileManager.default.fileExists(atPath: directory.appendingPathComponent(".rpc/transport-old-1-abc").path), "a stopped legacy writer must not recreate cleaned files")
}

private func managedMigrationFiles(_ directory: URL, _ mailbox: URL) throws -> [URL] {
    let fixtureURL = URL(fileURLWithPath: FileManager.default.currentDirectoryPath).appendingPathComponent("tests/fixtures/credentials/legacy-layouts.json")
    let fixture = try JSONSerialization.jsonObject(with: Data(contentsOf: fixtureURL)) as! [String: Any]
    let managed = fixture["managed"] as! [String: [String]]
    let rpc = directory.appendingPathComponent(".rpc")
    let session = rpc.appendingPathComponent("transport-old-1-abc")
    try FileManager.default.createDirectory(at: session, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
    var targets = managed["data"]!.map { directory.appendingPathComponent($0) }
    targets += managed["rpc"]!.map { rpc.appendingPathComponent($0) }
    targets += managed["rpc"]!.map { session.appendingPathComponent($0) }
    targets.append(session.appendingPathComponent(".10000000-0000-4000-8000-000000000006.tmp"))
    targets += managed["mailbox"]!.map { mailbox.appendingPathComponent($0) }
    for target in targets { try Data(migrationOldKey.utf8).write(to: target) }
    for name in managed["keep"]! { try Data("unrelated".utf8).write(to: directory.appendingPathComponent(name)) }
    try Data("unrelated".utf8).write(to: rpc.appendingPathComponent("extractor-a-1-abc.response.json"))
    let current = rpc.appendingPathComponent("transport-v2-current-1-abc")
    try FileManager.default.createDirectory(at: current, withIntermediateDirectories: false)
    try Data("unrelated".utf8).write(to: current.appendingPathComponent(".10000000-0000-4000-8000-000000000007.tmp"))
    return targets
}

private func migrationCleanupMatrix() async throws {
    let stages = CredentialCleanupStage.allCases
    for stage in stages {
        let directories = [.beforeDirectoryFsync, .afterDirectoryFsync].contains(stage) ? ["data", "rpc", "session", "mailbox", "parent", "preferences"] : ["all"]
        for scope in directories {
            let (directory, mailbox) = try migrationDirectories()
            defer { try? FileManager.default.removeItem(at: directory.deletingLastPathComponent()) }
            _ = try migrationFixture(directory)
            let targets = try managedMigrationFiles(directory, mailbox)
            let selected = ["data": directory, "rpc": directory.appendingPathComponent(".rpc"), "session": directory.appendingPathComponent(".rpc/transport-old-1-abc"), "mailbox": mailbox, "parent": mailbox.deletingLastPathComponent(), "preferences": migrationPreferenceFile(directory).deletingLastPathComponent()][scope]?.path
            let store = try SecureCredentialStore(directory: directory, mailboxDirectory: mailbox, preferenceFile: migrationPreferenceFile(directory), cleanupFault: { point, path in point == stage && (selected == nil || selected == path) })
            let migrated = try await store.migrateProfileState(commitID: UUID().uuidString, profiles: nil)
            let failed = try await store.cleanupProfileState(commitID: UUID().uuidString, migrationID: migrated.migration!.migrationId, preferenceConfirmed: true)
            try check(failed.migration?.cleanupState == "pending", "every unlink/rmdir/rescan/directory sync interruption must remain pending")
            let restarted = try SecureCredentialStore(directory: directory, mailboxDirectory: mailbox, preferenceFile: migrationPreferenceFile(directory))
            let recovered = try await restarted.cleanupProfileState(commitID: UUID().uuidString, migrationID: migrated.migration!.migrationId, preferenceConfirmed: true)
            try check(recovered.migration?.cleanupState == "clean", "cleanup must synchronize again even when an interrupted deletion left no file")
            try check(targets.allSatisfy { !FileManager.default.fileExists(atPath: $0.path) }, "all managed legacy copies must be gone after confirmed cleanup")
            try check(FileManager.default.fileExists(atPath: directory.appendingPathComponent("user-backup.json").path), "cleanup must preserve unrelated backups")
            try check(FileManager.default.fileExists(atPath: directory.appendingPathComponent(".rpc/transport-v2-current-1-abc/.10000000-0000-4000-8000-000000000007.tmp").path), "cleanup must preserve current transport sessions and hidden files")
        }
    }
}

private func migrationPreservesNewValue() async throws {
    let (directory, mailbox) = try migrationDirectories()
    defer { try? FileManager.default.removeItem(at: directory.deletingLastPathComponent()) }
    _ = try migrationFixture(directory)
    let store = try SecureCredentialStore(directory: directory, mailboxDirectory: mailbox, preferenceFile: migrationPreferenceFile(directory))
    let migrated = try await store.migrateProfileState(commitID: UUID().uuidString, profiles: nil)
    let pending = try await store.cleanupProfileState(commitID: UUID().uuidString, migrationID: migrated.migration!.migrationId, preferenceConfirmed: false)
    try check(pending.migration?.pendingClasses == ["legacy-preferences"], "preference cleanup requires explicit post-commit confirmation")
    let commit = UUID().uuidString
    let input = CredentialProfileSave(commitID: commit, expectedStoreRevision: pending.storeRevision, expectedProfileRevision: 3, profileID: migrationID, profileState: StoredProfileState(profiles: [migrationProfile(revision: 4)], activation: nil), requestDigest: CredentialCryptography.digest(Data(commit.utf8)))
    do { _ = try await store.saveProfile(input, value: Data("synthetic-migration-new-key".utf8)) }
    catch CredentialFailure.hardwareUnavailable { return }
    let before = try migrationDocument(directory)
    let restarted = try SecureCredentialStore(directory: directory, mailboxDirectory: mailbox, preferenceFile: migrationPreferenceFile(directory))
    async let first = store.cleanupProfileState(commitID: UUID().uuidString, migrationID: migrated.migration!.migrationId, preferenceConfirmed: true)
    async let second = restarted.cleanupProfileState(commitID: UUID().uuidString, migrationID: migrated.migration!.migrationId, preferenceConfirmed: true)
    _ = try await (first, second)
    let after = try migrationDocument(directory)
    let beforeBytes = try JSONSerialization.data(withJSONObject: ["credentials": before["credentials"]!, "keyRing": before["keyRing"]!], options: [.sortedKeys])
    let afterBytes = try JSONSerialization.data(withJSONObject: ["credentials": after["credentials"]!, "keyRing": after["keyRing"]!], options: [.sortedKeys])
    try check(beforeBytes == afterBytes, "concurrent cleanup retries must never reset or re-encrypt the newest credentials")
    let value = try await restarted.readCredential(profileID: migrationID, expectedProfileRevision: 4)
    try check(value == Data("synthetic-migration-new-key".utf8), "newly entered credentials must remain readable after cleanup and restart")
}

private func migrationUnsafePathsAndDocuments() async throws {
    let (directory, mailbox) = try migrationDirectories()
    defer { try? FileManager.default.removeItem(at: directory.deletingLastPathComponent()) }
    _ = try migrationFixture(directory)
    let outside = directory.deletingLastPathComponent().appendingPathComponent("unrelated-source")
    try Data(migrationOldKey.utf8).write(to: outside)
    try FileManager.default.createSymbolicLink(at: directory.appendingPathComponent(".credentials.tmp"), withDestinationURL: outside)
    let store = try SecureCredentialStore(directory: directory, mailboxDirectory: mailbox, preferenceFile: migrationPreferenceFile(directory))
    let migrated = try await store.migrateProfileState(commitID: UUID().uuidString, profiles: nil)
    let pending = try await store.cleanupProfileState(commitID: UUID().uuidString, migrationID: migrated.migration!.migrationId, preferenceConfirmed: true)
    try check(pending.migration?.pendingClasses.contains("legacy-credentials") == true, "a managed-name symlink must fail closed instead of being followed")
    let outsideBytes = try Data(contentsOf: outside)
    try check(outsideBytes == Data(migrationOldKey.utf8), "cleanup must not touch a symlink target")
    if geteuid() != 0 {
        let wrongOwner = try SecureCredentialStore(directory: directory, mailboxDirectory: URL(fileURLWithPath: "/private/tmp"), preferenceFile: migrationPreferenceFile(directory))
        let refused = try await wrongOwner.cleanupProfileState(commitID: UUID().uuidString, migrationID: migrated.migration!.migrationId, preferenceConfirmed: true)
        try check(refused.migration?.pendingClasses.contains("legacy-mailbox") == true, "a foreign-owned root must not be enumerated or cleaned")
    }
    for bad in [Data("{\"formatVersion\":1,".utf8), Data("{\"formatVersion\":99,\"credentials\":{}}".utf8)] {
        try bad.write(to: directory.appendingPathComponent("credentials.json"))
        do { _ = try await store.initializeProfileState(commitID: UUID().uuidString, expectedStoreRevision: 0, profiles: []); throw ContractTestFailure(description: "damaged source must never become an empty store") }
        catch is ContractTestFailure { throw ContractTestFailure(description: "damaged source must never become an empty store") }
        catch { }
        let retained = try Data(contentsOf: directory.appendingPathComponent("credentials.json"))
        try check(retained == bad, "unknown or damaged source must remain unchanged")
    }
}

private func migrationOnlyCredentials() async throws {
    let (directory, mailbox) = try migrationDirectories()
    defer { try? FileManager.default.removeItem(at: directory.deletingLastPathComponent()) }
    let original = try migrationFixture(directory, profileState: false)
    let store = try SecureCredentialStore(directory: directory, mailboxDirectory: mailbox, preferenceFile: migrationPreferenceFile(directory))
    do { _ = try await store.migrateProfileState(commitID: UUID().uuidString, profiles: nil); throw ContractTestFailure(description: "a unique preference metadata source is required") }
    catch is ContractTestFailure { throw ContractTestFailure(description: "a unique preference metadata source is required") }
    catch { }
    let unchanged = try Data(contentsOf: directory.appendingPathComponent("credentials.json"))
    try check(unchanged == original, "missing metadata must preserve the unique v1 source")
    let migrated = try await store.migrateProfileState(commitID: UUID().uuidString, profiles: [migrationProfile(revision: 1)])
    try check(migrated.profileState?.profiles == [migrationProfile(revision: 1)] && migrated.profileState?.activation == nil, "credentials-only migration uses normalized metadata and no invented activation")
}

private func migrationCommitFaults() async throws {
    for stage in [CredentialPersistStage.beforeWrite, .beforeFsync, .beforeRename, .afterRename, .beforeDirectoryFsync, .beforeReadback] {
        let (directory, mailbox) = try migrationDirectories()
        defer { try? FileManager.default.removeItem(at: directory.deletingLastPathComponent()) }
        let original = try migrationFixture(directory)
        let store = try SecureCredentialStore(directory: directory, fault: { $0 == stage }, mailboxDirectory: mailbox, preferenceFile: migrationPreferenceFile(directory))
        do { _ = try await store.migrateProfileState(commitID: UUID().uuidString, profiles: nil); throw ContractTestFailure(description: "migration fault must prevent an acknowledged commit") }
        catch is ContractTestFailure { throw ContractTestFailure(description: "migration fault must prevent an acknowledged commit") }
        catch { }
        let current = try Data(contentsOf: directory.appendingPathComponent("credentials.json"))
        if [.beforeWrite, .beforeFsync, .beforeRename].contains(stage) {
            try check(current == original, "pre-rename migration failure must retain the sole configuration source")
        } else {
            let document = try migrationDocument(directory)
            try check(document["formatVersion"] as? Int == 2, "post-rename migration failure must retain the committed v2 instead of rolling back")
            let recovered = try SecureCredentialStore(directory: directory, mailboxDirectory: mailbox, preferenceFile: migrationPreferenceFile(directory))
            let opened = try await recovered.openProfileState(commitID: UUID().uuidString)
            try check(opened.profileState?.profiles == [migrationProfile()], "a restart must durably confirm the current v2 metadata")
        }
    }
}
