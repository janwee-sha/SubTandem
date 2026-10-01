import Darwin
import Foundation

struct StoredProviderProfile: Codable, Equatable, Sendable {
    let profileId: String
    let revision: Int
    let displayName: String
    let kind: String
    let endpoint: String
    let endpointFingerprint: String
    let proxyMode: String?
    let model: String?
    let capability: String?
}

struct StoredActivationReference: Codable, Equatable, Sendable {
    let profileId: String
    let profileRevision: Int
    let kind: String
    let endpointFingerprint: String
    var credentialConfigured: Bool
}

struct StoredProfileState: Codable, Equatable, Sendable {
    var profiles: [StoredProviderProfile]
    var activation: StoredActivationReference?
    enum CodingKeys: String, CodingKey {
        case profiles, activation
    }
    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(profiles, forKey: .profiles)
        try container.encode(activation, forKey: .activation)
    }
}

struct StoredCommitReceipt: Codable, Equatable, Sendable {
    let commitId: String
    let operation: String
    let baseRevision: Int
    let requestDigest: String
}

struct ProfileStoreSnapshot: Codable, Equatable, Sendable {
    let initialized: Bool
    let storeRevision: Int
    let lastCommit: StoredCommitReceipt?
    let profileState: StoredProfileState?
    let credentialConfigured: [String: Bool]
    let invalidActivation: Bool?
    var migration: CredentialMigrationState? = nil
    var recovery: String? = nil
}

enum CredentialPersistStage: Sendable {
    case beforeWrite
    case beforeFsync
    case beforeRename
    case afterRename
    case beforeDirectoryFsync
    case beforeReadback
}

struct CredentialProfileSave: Sendable {
    let commitID: String
    let expectedStoreRevision: Int
    let expectedProfileRevision: Int
    let profileID: String
    let profileState: StoredProfileState
    let requestDigest: String
}

protocol CredentialStoreAccess: Sendable {
    func recoverProfileState(commitID: String, expiresAtMs: Int64) async throws -> ProfileStoreSnapshot
    func readCredential(profileID: String, expectedProfileRevision: Int) async throws -> Data?
    func confirmSave(commitID: String, expectedStoreRevision: Int, requestDigest: String) async throws -> ProfileStoreSnapshot?
    func saveProfile(_ input: CredentialProfileSave, value: Data) async throws -> ProfileStoreSnapshot
    func readProfileState() async throws -> ProfileStoreSnapshot
    func migrateProfileState(commitID: String, profiles: [StoredProviderProfile]?) async throws -> ProfileStoreSnapshot
    func cleanupProfileState(commitID: String, migrationID: String, preferenceConfirmed: Bool) async throws -> ProfileStoreSnapshot
    func openProfileState(commitID: String) async throws -> ProfileStoreSnapshot
    func initializeProfileState(
        commitID: String,
        expectedStoreRevision: Int,
        profiles: [StoredProviderProfile]
    ) async throws -> ProfileStoreSnapshot
    func commitProfileState(
        commitID: String,
        expectedStoreRevision: Int,
        profileState: StoredProfileState
    ) async throws -> ProfileStoreSnapshot

}

extension CredentialStoreAccess {
    func recoverProfileState(commitID: String, expiresAtMs: Int64) async throws -> ProfileStoreSnapshot { throw TransportProtocolError.invalidRequest }
    func migrateProfileState(commitID: String, profiles: [StoredProviderProfile]?) async throws -> ProfileStoreSnapshot { throw TransportProtocolError.invalidRequest }
    func cleanupProfileState(commitID: String, migrationID: String, preferenceConfirmed: Bool) async throws -> ProfileStoreSnapshot { throw TransportProtocolError.invalidRequest }
}

struct CredentialMigrationState: Codable, Equatable, Sendable {
    let migrationId: String
    let sourceFormat: Int
    let sourceLayout: String
    var commitState: String
    var cleanupState: String
    var pendingClasses: [String]
}

enum CredentialStoreFailure: Error {
    case unconfirmed
}

actor SecureCredentialStore: CredentialStoreAccess {
    private struct Document: Codable, Equatable {
        var formatVersion = 2
        var storeId = UUID().uuidString.lowercased()
        var credentials: [String: CredentialStoredValue] = [:]
        var keyRing: [String: CredentialDeviceKeySlot] = [:]
        var storeRevision = 0
        var lastCommit: StoredCommitReceipt?
        var profileState: StoredProfileState?
        var migration: CredentialMigrationState?
        var unknownCredentialIDs: Set<String> = []
        var unsafeCredentialContainer = false
        var unsafeKeyRing = false
        var invalidActivation = false

        enum CodingKeys: String, CodingKey {
            case formatVersion, storeId, credentials, keyRing, storeRevision, lastCommit, profileState, migration
        }

        func encode(to encoder: Encoder) throws {
            var container = encoder.container(keyedBy: CodingKeys.self)
            try container.encode(formatVersion, forKey: .formatVersion)
            try container.encode(storeId, forKey: .storeId)
            try container.encode(credentials, forKey: .credentials)
            try container.encode(keyRing, forKey: .keyRing)
            try container.encode(storeRevision, forKey: .storeRevision)
            try container.encode(lastCommit, forKey: .lastCommit)
            try container.encode(profileState, forKey: .profileState)
            try container.encode(migration, forKey: .migration)
        }
    }

    private static let maximumFileBytes = 1_048_576
    private static let maximumRevision = 9_007_199_254_740_991
    private let directory: URL
    private let file: URL
    private let lockFile: URL
    private let protection: CredentialProtection
    private let fault: @Sendable (CredentialPersistStage) -> Bool
    private let mailboxDirectory: URL?
    private let preferenceFile: URL?
    private let cleanupFault: @Sendable (CredentialCleanupStage, String) -> Bool

    init(directory: URL, protection: CredentialProtection = CredentialProtection(), fault: @escaping @Sendable (CredentialPersistStage) -> Bool = { _ in false }, mailboxDirectory: URL? = nil, preferenceFile: URL? = nil, cleanupFault: @escaping @Sendable (CredentialCleanupStage, String) -> Bool = { _, _ in false }) throws {
        guard directory.isFileURL, directory.path.hasPrefix("/") else { throw TransportProtocolError.invalidRequest }
        self.directory = directory.standardizedFileURL
        self.file = self.directory.appendingPathComponent("credentials.json")
        self.lockFile = self.directory.appendingPathComponent(".credentials.lock")
        self.protection = protection
        self.fault = fault
        self.mailboxDirectory = mailboxDirectory
        self.preferenceFile = preferenceFile ?? (self.directory.deletingLastPathComponent().lastPathComponent == ".data" ? self.directory.deletingLastPathComponent().deletingLastPathComponent().appendingPathComponent(".preferences/\(self.directory.lastPathComponent).plist") : nil)
        self.cleanupFault = cleanupFault
        try FileManager.default.createDirectory(at: self.directory, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
        let directoryFD = open(self.directory.path, O_RDONLY | O_DIRECTORY | O_NOFOLLOW)
        guard directoryFD >= 0 else { throw TransportProtocolError.credentialStoreUnavailable }
        defer { close(directoryFD) }
        var status = stat()
        guard fstat(directoryFD, &status) == 0, status.st_uid == geteuid(), status.st_mode & S_IFMT == S_IFDIR, status.st_mode & 0o700 == 0o700,
              fchmod(directoryFD, 0o700) == 0 else { throw TransportProtocolError.credentialStoreUnavailable }
        let descriptor = open(self.lockFile.path, O_RDWR | O_CREAT | O_NOFOLLOW, mode_t(S_IRUSR | S_IWUSR))
        guard descriptor >= 0 else { throw TransportProtocolError.credentialStoreUnavailable }
        defer { close(descriptor) }
        try Self.validateOwnedRegularFile(descriptor)
    }

    func readProfileState() throws -> ProfileStoreSnapshot {
        try withLock { snapshot(try load()) }
    }

    func recoverProfileState(commitID: String, expiresAtMs: Int64) async throws -> ProfileStoreSnapshot {
        try Self.validateIdentity(commitID)
        guard expiresAtMs >= 0, expiresAtMs <= Int64(Self.maximumRevision), expiresAtMs <= Self.nowMs + 15000 else { throw TransportProtocolError.invalidRequest }
        return try withLock(deadlineMs: max(expiresAtMs, Self.nowMs + 1)) {
            let bytes = try readBytes()
            if let bytes {
                if let legacy = try? CredentialMigration.legacy(bytes) { throw CredentialMigrationFailure.required(legacy.sourceLayout) }
                if let document = try? decodeDocument(bytes) {
                    var result: ProfileStoreSnapshot
                    if document.lastCommit?.commitId == commitID {
                        guard let confirmed = try confirm(document, operation: "recover", commitID: commitID, expectedRevision: 0, requestDigest: Self.recoveryDigest()) else { throw TransportProtocolError.profileStateConflict }
                        result = confirmed
                        result.recovery = "reset"
                    } else {
                        result = snapshot(document)
                        result.recovery = "retained"
                    }
                    return result
                }
            }
            try Self.checkDeadline(expiresAtMs)
            var document = Document()
            document.profileState = StoredProfileState(profiles: [], activation: nil)
            document.storeRevision = 1
            document.lastCommit = StoredCommitReceipt(commitId: commitID, operation: "recover", baseRevision: 0, requestDigest: Self.recoveryDigest())
            try persist(document, deadlineMs: expiresAtMs)
            var result = snapshot(document)
            result.recovery = bytes == nil ? "initialized" : "reset"
            return result
        }
    }

    func migrateProfileState(commitID: String, profiles: [StoredProviderProfile]?) async throws -> ProfileStoreSnapshot {
        try Self.validateIdentity(commitID)
        return try withLock {
            guard let data = try readBytes() else { throw CredentialMigrationFailure.notCommitted }
            guard let legacy = try CredentialMigration.legacy(data) else {
                let document = try load()
                guard document.migration != nil else { throw TransportProtocolError.profileStateConflict }
                do { try synchronizeDirectory(); guard try load() == document else { throw CredentialMigrationFailure.unconfirmed } }
                catch { throw CredentialMigrationFailure.unconfirmed }
                return snapshot(document)
            }
            let state: StoredProfileState
            if let existing = legacy.profileState {
                guard profiles == nil else { throw TransportProtocolError.invalidProfileState }
                state = existing
            } else {
                guard let profiles else { throw CredentialMigrationFailure.required("credentials-only") }
                state = StoredProfileState(profiles: profiles, activation: nil)
            }
            try Self.validateProfileState(state, credentials: [:])
            var document = Document()
            document.profileState = state
            document.storeRevision = try Self.nextRevision(legacy.storeRevision)
            document.migration = CredentialMigrationState(migrationId: UUID().uuidString.lowercased(), sourceFormat: 1, sourceLayout: legacy.sourceLayout, commitState: "committed", cleanupState: "pending", pendingClasses: CredentialMigration.classes)
            document.lastCommit = StoredCommitReceipt(commitId: commitID, operation: "migrate", baseRevision: legacy.storeRevision, requestDigest: try Self.stateDigest(state))
            do { try persist(document) }
            catch CredentialStoreFailure.unconfirmed { throw CredentialMigrationFailure.unconfirmed }
            catch { throw CredentialMigrationFailure.notCommitted }
            return snapshot(document)
        }
    }

    func cleanupProfileState(commitID: String, migrationID: String, preferenceConfirmed: Bool) async throws -> ProfileStoreSnapshot {
        try Self.validateIdentity(commitID)
        try Self.validateIdentity(migrationID)
        return try withLock {
            var document = try load()
            guard var migration = document.migration, migration.migrationId == migrationID else { throw TransportProtocolError.profileStateConflict }
            let digest = CredentialCryptography.digest(try JSONSerialization.data(withJSONObject: ["migrationId": migrationID, "preferenceConfirmed": preferenceConfirmed], options: [.sortedKeys]))
            if let confirmed = try confirm(document, operation: "cleanup", commitID: commitID, expectedRevision: nil, requestDigest: digest) { return confirmed }
            do { try synchronizeDirectory(); guard try load() == document else { throw CredentialMigrationFailure.unconfirmed } }
            catch { throw CredentialMigrationFailure.unconfirmed }
            if migration.cleanupState == "clean" { return snapshot(document) }
            let cleaner = CredentialMigration(directory: directory, mailboxDirectory: mailboxDirectory, preferenceFile: preferenceFile, fault: cleanupFault)
            let pending = cleaner.cleanup(migration.pendingClasses, preferenceConfirmed: preferenceConfirmed)
            if pending == migration.pendingClasses { return snapshot(document) }
            migration.pendingClasses = pending
            migration.cleanupState = pending.isEmpty ? "clean" : "pending"
            document.migration = migration
            let revision = document.storeRevision
            document.storeRevision = try Self.nextRevision(revision)
            document.lastCommit = StoredCommitReceipt(commitId: commitID, operation: "cleanup", baseRevision: revision, requestDigest: digest)
            try persist(document)
            return snapshot(document)
        }
    }

    func readCredential(profileID: String, expectedProfileRevision: Int) throws -> Data? {
        try Self.validateIdentity(profileID)
        return try withLock {
            let document = try load()
            guard let profile = document.profileState?.profiles.first(where: { $0.profileId == profileID }), profile.revision == expectedProfileRevision
            else { throw TransportProtocolError.profileStateConflict }
            guard !document.unknownCredentialIDs.contains(profileID), !document.unsafeKeyRing else { throw TransportProtocolError.credentialStoreUnavailable }
            guard let stored = document.credentials[profileID] else { return nil }
            return try protection.open(stored, storeID: document.storeId, profileID: profileID, slots: document.keyRing)
        }
    }

    func confirmSave(commitID: String, expectedStoreRevision: Int, requestDigest: String) throws -> ProfileStoreSnapshot? {
        try Self.validateIdentity(commitID)
        guard (0..<Self.maximumRevision).contains(expectedStoreRevision), Self.validDigest(requestDigest) else { throw TransportProtocolError.invalidRequest }
        return try withLock {
            let document = try load()
            if let confirmed = try confirm(document, operation: "save-profile", commitID: commitID, expectedRevision: expectedStoreRevision, requestDigest: requestDigest) { return confirmed }
            guard document.storeRevision == expectedStoreRevision else { throw TransportProtocolError.profileStateConflict }
            return nil
        }
    }

    func saveProfile(_ input: CredentialProfileSave, value: Data) throws -> ProfileStoreSnapshot {
        try validateSaveIdentity(input)
        return try mutate(operation: "save-profile", commitID: input.commitID, expectedStoreRevision: input.expectedStoreRevision, requestDigest: input.requestDigest) { document in
            guard let previous = document.profileState else { throw TransportProtocolError.profileStateConflict }
            let old = previous.profiles.first { $0.profileId == input.profileID }
            guard (old?.revision ?? 0) == input.expectedProfileRevision,
                  let candidate = input.profileState.profiles.first(where: { $0.profileId == input.profileID }),
                  candidate.revision == input.expectedProfileRevision + 1,
                  previous.profiles.filter({ $0.profileId != input.profileID }) == input.profileState.profiles.filter({ $0.profileId != input.profileID })
            else { throw TransportProtocolError.profileStateConflict }
            let expectedActivation = previous.activation?.profileId == input.profileID ? nil : previous.activation
            guard input.profileState.activation == expectedActivation else { throw TransportProtocolError.invalidProfileState }
            try Self.validateProfiles(input.profileState.profiles)
            guard value.count <= CredentialWire.keyBytes, String(data: value, encoding: .utf8) != nil else { throw CredentialFailure.tooLarge }
            if value.isEmpty {
                document.credentials.removeValue(forKey: input.profileID)
            } else {
                let slot = try protection.makeKeySlot()
                let encrypted = try protection.seal(value, storeID: document.storeId, profileID: input.profileID, slot: slot)
                document.credentials[input.profileID] = encrypted
                document.keyRing[slot.keyID] = slot
            }
            document.unknownCredentialIDs.remove(input.profileID)
            document.profileState = input.profileState
            document.invalidActivation = false
            try Self.validateProfileState(input.profileState, credentials: document.credentials)
        }
    }

    func openProfileState(commitID: String) throws -> ProfileStoreSnapshot {
        try Self.validateIdentity(commitID)
        return try withLock {
            var document = try load()
            let digest = CredentialCryptography.digest(Data("open".utf8))
            if let confirmed = try confirm(document, operation: "open", commitID: commitID, expectedRevision: nil, requestDigest: digest) { return confirmed }
            guard document.profileState != nil else { return snapshot(document) }
            let revision = document.storeRevision
            document.storeRevision = try Self.nextRevision(revision)
            document.lastCommit = StoredCommitReceipt(commitId: commitID, operation: "open", baseRevision: revision, requestDigest: digest)
            try persist(document)
            return snapshot(document)
        }
    }

    func initializeProfileState(commitID: String, expectedStoreRevision: Int, profiles: [StoredProviderProfile]) throws -> ProfileStoreSnapshot {
        let state = StoredProfileState(profiles: profiles, activation: nil)
        return try mutate(operation: "initialize", commitID: commitID, expectedStoreRevision: expectedStoreRevision, requestDigest: Self.stateDigest(state)) { document in
            guard document.profileState == nil else { throw TransportProtocolError.profileStateConflict }
            try Self.validateProfileState(state, credentials: [:])
            document.profileState = state
        }
    }

    func commitProfileState(commitID: String, expectedStoreRevision: Int, profileState: StoredProfileState) throws -> ProfileStoreSnapshot {
        try mutate(operation: "commit", commitID: commitID, expectedStoreRevision: expectedStoreRevision, requestDigest: Self.stateDigest(profileState)) { document in
            guard let previous = document.profileState else { throw TransportProtocolError.profileStateConflict }
            for profile in profileState.profiles {
                guard previous.profiles.contains(profile) else { throw TransportProtocolError.invalidProfileState }
            }
            let remaining = Set(profileState.profiles.map(\.profileId))
            document.credentials = document.credentials.filter { remaining.contains($0.key) }
            try Self.validateProfileState(profileState, credentials: document.credentials)
            document.profileState = profileState
            document.invalidActivation = false
        }
    }

    private func validateSaveIdentity(_ input: CredentialProfileSave) throws {
        try Self.validateIdentity(input.commitID)
        try Self.validateIdentity(input.profileID)
        guard (0..<Self.maximumRevision).contains(input.expectedStoreRevision),
              (0..<Self.maximumRevision).contains(input.expectedProfileRevision), Self.validDigest(input.requestDigest)
        else { throw TransportProtocolError.invalidRequest }
    }

    private func mutate(operation: String, commitID: String, expectedStoreRevision: Int, requestDigest: String, update: (inout Document) throws -> Void) throws -> ProfileStoreSnapshot {
        try Self.validateIdentity(commitID)
        guard (0..<Self.maximumRevision).contains(expectedStoreRevision), Self.validDigest(requestDigest) else { throw TransportProtocolError.invalidRequest }
        return try withLock {
            var document = try load()
            if let confirmed = try confirm(document, operation: operation, commitID: commitID, expectedRevision: expectedStoreRevision, requestDigest: requestDigest) { return confirmed }
            guard document.storeRevision == expectedStoreRevision else { throw TransportProtocolError.profileStateConflict }
            try update(&document)
            document.lastCommit = StoredCommitReceipt(commitId: commitID, operation: operation, baseRevision: expectedStoreRevision, requestDigest: requestDigest)
            document.storeRevision = try Self.nextRevision(expectedStoreRevision)
            try persist(document)
            return snapshot(document)
        }
    }

    private func confirm(_ document: Document, operation: String, commitID: String, expectedRevision: Int?, requestDigest: String) throws -> ProfileStoreSnapshot? {
        guard let receipt = document.lastCommit, receipt.commitId == commitID else { return nil }
        guard receipt.operation == operation, (expectedRevision == nil || receipt.baseRevision == expectedRevision), receipt.requestDigest == requestDigest
        else { throw TransportProtocolError.profileStateConflict }
        do {
            try synchronizeDirectory()
            if fault(.beforeReadback) { throw CredentialStoreFailure.unconfirmed }
            guard try load() == document else { throw CredentialStoreFailure.unconfirmed }
        } catch { throw CredentialStoreFailure.unconfirmed }
        return snapshot(document)
    }

    private func withLock<T>(deadlineMs: Int64 = SecureCredentialStore.nowMs + 15000, _ operation: () throws -> T) throws -> T {
        let directoryFD = open(directory.path, O_RDONLY | O_DIRECTORY | O_NOFOLLOW)
        guard directoryFD >= 0 else { throw TransportProtocolError.credentialStoreUnavailable }
        defer { close(directoryFD) }
        var status = stat()
        guard fstat(directoryFD, &status) == 0, status.st_uid == geteuid(), status.st_mode & S_IFMT == S_IFDIR, status.st_mode & 0o700 == 0o700 else { throw TransportProtocolError.credentialStoreUnavailable }
        let descriptor = open(lockFile.path, O_RDWR | O_CREAT | O_NOFOLLOW, mode_t(S_IRUSR | S_IWUSR))
        guard descriptor >= 0 else { throw TransportProtocolError.credentialStoreUnavailable }
        defer { close(descriptor) }
        try Self.validateOwnedRegularFile(descriptor)
        while flock(descriptor, LOCK_EX | LOCK_NB) != 0 {
            guard errno == EINTR || errno == EWOULDBLOCK else { throw TransportProtocolError.credentialStoreUnavailable }
            try Self.checkDeadline(deadlineMs)
            usleep(1000)
        }
        defer { flock(descriptor, LOCK_UN) }
        return try operation()
    }

    private func readBytes() throws -> Data? {
        let descriptor = open(file.path, O_RDONLY | O_NOFOLLOW)
        guard descriptor >= 0 else {
            if errno == ENOENT { return nil }
            throw TransportProtocolError.credentialStoreUnavailable
        }
        defer { close(descriptor) }
        try Self.validateOwnedRegularFile(descriptor)
        var status = stat()
        guard fstat(descriptor, &status) == 0, status.st_size >= 0, status.st_size <= Self.maximumFileBytes else { throw TransportProtocolError.credentialStoreUnavailable }
        var data = Data()
        var buffer = [UInt8](repeating: 0, count: 16384)
        while true {
            let count = Darwin.read(descriptor, &buffer, buffer.count)
            if count < 0 && errno == EINTR { continue }
            if count == 0 { break }
            guard count > 0, data.count + count <= Self.maximumFileBytes else { throw TransportProtocolError.credentialStoreUnavailable }
            data.append(buffer, count: count)
        }
        return data
    }

    private func load() throws -> Document {
        guard let data = try readBytes() else { return Document() }
        return try decodeDocument(data)
    }

    private func decodeDocument(_ data: Data) throws -> Document {
        if let legacy = try CredentialMigration.legacy(data) { throw CredentialMigrationFailure.required(legacy.sourceLayout) }
        do {
            let object = try CredentialWire.record(JSONSerialization.jsonObject(with: data), keys: ["formatVersion", "storeId", "storeRevision", "profileState", "keyRing", "credentials", "lastCommit", "migration"])
            guard try CredentialWire.integer(object["formatVersion"]) == 2 else { throw TransportProtocolError.credentialStoreUnavailable }
            var metadata = object
            metadata["credentials"] = [String: String]()
            metadata["keyRing"] = [String: String]()
            let projectedState = try Self.projectProfileState(object["profileState"])
            metadata["profileState"] = try JSONSerialization.jsonObject(with: JSONEncoder().encode(projectedState.state))
            var document = try JSONDecoder().decode(Document.self, from: JSONSerialization.data(withJSONObject: metadata))
            document.invalidActivation = projectedState.invalidActivation
            if let migration = document.migration {
                _ = try CredentialWire.record(object["migration"] as Any, keys: ["migrationId", "sourceFormat", "sourceLayout", "commitState", "cleanupState", "pendingClasses"])
                try CredentialMigration.validate(migration)
            }
            try Self.validateIdentity(document.storeId)
            guard (1...Self.maximumRevision).contains(document.storeRevision), let state = document.profileState else { throw TransportProtocolError.credentialStoreUnavailable }
            try Self.validateProfiles(state.profiles)
            let identities = Set(state.profiles.map(\.profileId))
            if let credentials = object["credentials"] as? [String: Any] {
                if !Set(credentials.keys).isSubset(of: identities) { document.unsafeCredentialContainer = true }
                for (id, raw) in credentials where identities.contains(id) {
                    do {
                        _ = try CredentialWire.record(raw, keys: ["credentialId", "envelope"])
                        let value = try JSONDecoder().decode(CredentialStoredValue.self, from: JSONSerialization.data(withJSONObject: raw))
                        try Self.validateIdentity(value.credentialID)
                        guard value.envelope.utf8.count <= 4 * ((CredentialWire.sealedBytes + 2) / 3) else { throw TransportProtocolError.credentialStoreUnavailable }
                        document.credentials[id] = value
                    } catch { document.unknownCredentialIDs.insert(id) }
                }
            } else {
                document.unknownCredentialIDs = identities
                document.unsafeCredentialContainer = true
            }
            if let slots = object["keyRing"] as? [String: Any] {
                for (id, raw) in slots {
                    do {
                        try Self.validateIdentity(id)
                        _ = try CredentialWire.record(raw, keys: ["keyId", "wrappedRepresentation"])
                        let slot = try JSONDecoder().decode(CredentialDeviceKeySlot.self, from: JSONSerialization.data(withJSONObject: raw))
                        guard slot.keyID == id, slot.wrappedRepresentation.utf8.count <= 4 * ((16384 + 2) / 3) else { throw TransportProtocolError.credentialStoreUnavailable }
                        document.keyRing[id] = slot
                    } catch { document.unsafeKeyRing = true }
                }
            } else { document.unsafeKeyRing = true }
            guard let receipt = document.lastCommit, ["open", "initialize", "commit", "save-profile", "migrate", "cleanup", "recover"].contains(receipt.operation), receipt.baseRevision >= 0, receipt.baseRevision == document.storeRevision - 1, Self.validDigest(receipt.requestDigest)
            else { throw TransportProtocolError.credentialStoreUnavailable }
            try Self.validateIdentity(receipt.commitId)
            _ = try CredentialWire.record(object["lastCommit"] as Any, keys: ["commitId", "operation", "baseRevision", "requestDigest"])
            return document
        } catch { throw TransportProtocolError.credentialStoreUnavailable }
    }

    private func snapshot(_ document: Document) -> ProfileStoreSnapshot {
        let configured = Dictionary(uniqueKeysWithValues: (document.profileState?.profiles ?? []).map { ($0.profileId, document.credentials[$0.profileId] != nil || document.unknownCredentialIDs.contains($0.profileId)) })
        var state = document.profileState
        if let id = state?.activation?.profileId, document.unknownCredentialIDs.contains(id) { state?.activation?.credentialConfigured = true }
        let invalid = document.invalidActivation || (state.map { !Self.activationIsValid($0, credentials: document.credentials, unknown: document.unknownCredentialIDs) } ?? false)
        if invalid { state?.activation = nil }
        return ProfileStoreSnapshot(initialized: state != nil, storeRevision: document.storeRevision, lastCommit: document.lastCommit, profileState: state, credentialConfigured: configured, invalidActivation: invalid ? true : nil, migration: document.migration)
    }

    private func persist(_ document: Document, deadlineMs: Int64? = nil) throws {
        guard document.unknownCredentialIDs.isEmpty, !document.unsafeCredentialContainer, !document.unsafeKeyRing else { throw TransportProtocolError.credentialStoreUnavailable }
        if let deadlineMs { try Self.checkDeadline(deadlineMs) }
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys, .withoutEscapingSlashes]
        let data = try encoder.encode(document)
        guard data.count <= Self.maximumFileBytes else { throw TransportProtocolError.credentialStoreUnavailable }
        let temporary = directory.appendingPathComponent(".credentials-v2-\(UUID().uuidString).tmp")
        let descriptor = open(temporary.path, O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW, mode_t(S_IRUSR | S_IWUSR))
        guard descriptor >= 0 else { throw TransportProtocolError.credentialStoreUnavailable }
        var renamed = false
        defer { close(descriptor); if !renamed { unlink(temporary.path) } }
        try Self.validateOwnedRegularFile(descriptor)
        if fault(.beforeWrite) { throw TransportProtocolError.credentialStoreUnavailable }
        if let deadlineMs { try Self.checkDeadline(deadlineMs) }
        try data.withUnsafeBytes { buffer in
            guard let address = buffer.baseAddress else { throw TransportProtocolError.credentialStoreUnavailable }
            var offset = 0
            while offset < data.count {
                #if SUBTANDEM_CREDENTIAL_TEST_OBSERVER
                CredentialWriteObserver.shared.capture(path: temporary.path, bytes: data.subdata(in: offset..<data.count))
                #endif
                let count = Darwin.write(descriptor, address.advanced(by: offset), data.count - offset)
                if count < 0 && errno == EINTR { continue }
                guard count > 0 else { throw TransportProtocolError.credentialStoreUnavailable }
                offset += count
            }
        }
        if fault(.beforeFsync) { throw TransportProtocolError.credentialStoreUnavailable }
        guard fsync(descriptor) == 0 else { throw TransportProtocolError.credentialStoreUnavailable }
        if fault(.beforeRename) { throw TransportProtocolError.credentialStoreUnavailable }
        if let deadlineMs { try Self.checkDeadline(deadlineMs) }
        _ = try readBytes()
        guard rename(temporary.path, file.path) == 0 else { throw TransportProtocolError.credentialStoreUnavailable }
        renamed = true
        do {
            if fault(.afterRename) { throw CredentialStoreFailure.unconfirmed }
            try synchronizeDirectory()
            if fault(.beforeReadback) { throw CredentialStoreFailure.unconfirmed }
            guard try readBytes() == data, try load() == document else { throw CredentialStoreFailure.unconfirmed }
        } catch { throw CredentialStoreFailure.unconfirmed }
    }

    private func synchronizeDirectory() throws {
        if fault(.beforeDirectoryFsync) { throw CredentialStoreFailure.unconfirmed }
        let descriptor = open(directory.path, O_RDONLY | O_DIRECTORY | O_NOFOLLOW)
        guard descriptor >= 0 else { throw CredentialStoreFailure.unconfirmed }
        defer { close(descriptor) }
        var status = stat()
        guard fstat(descriptor, &status) == 0, status.st_uid == geteuid(), status.st_mode & S_IFMT == S_IFDIR, fsync(descriptor) == 0 else { throw CredentialStoreFailure.unconfirmed }
    }

    private static func validateOwnedRegularFile(_ descriptor: Int32) throws {
        var status = stat()
        guard fstat(descriptor, &status) == 0, status.st_uid == geteuid(), status.st_mode & S_IFMT == S_IFREG, status.st_nlink == 1, status.st_mode & 0o600 == 0o600, fchmod(descriptor, 0o600) == 0 else { throw TransportProtocolError.credentialStoreUnavailable }
    }

    static func validateProfileFields(_ value: Any?) throws {
        let state = try CredentialWire.record(value as Any, keys: ["profiles", "activation"])
        guard let profiles = state["profiles"] as? [[String: Any]] else { throw TransportProtocolError.invalidProfileState }
        for profile in profiles {
            let optional = ["model", "capability"].filter { profile[$0] != nil }
            _ = try CredentialWire.record(profile, keys: ["profileId", "revision", "displayName", "kind", "endpoint", "endpointFingerprint", "proxyMode"] + optional)
            _ = try CredentialWire.integer(profile["revision"], minimum: 1)
        }
        if !(state["activation"] is NSNull) {
            let activation = try CredentialWire.record(state["activation"] as Any, keys: ["profileId", "profileRevision", "kind", "endpointFingerprint", "credentialConfigured"])
            _ = try CredentialWire.integer(activation["profileRevision"], minimum: 1)
        }
    }

    static func projectProfileState(_ value: Any?) throws -> (state: StoredProfileState, invalidActivation: Bool) {
        var raw = try CredentialWire.record(value as Any, keys: ["profiles", "activation"])
        let activation = raw["activation"]
        raw["activation"] = NSNull()
        try validateProfileFields(raw)
        var state = try JSONDecoder().decode(StoredProfileState.self, from: JSONSerialization.data(withJSONObject: raw))
        try validateProfiles(state.profiles)
        guard !(activation is NSNull) else { return (state, false) }
        do {
            let fields = try CredentialWire.record(activation as Any, keys: ["profileId", "profileRevision", "kind", "endpointFingerprint", "credentialConfigured"])
            _ = try CredentialWire.integer(fields["profileRevision"], minimum: 1)
            state.activation = try JSONDecoder().decode(StoredActivationReference.self, from: JSONSerialization.data(withJSONObject: fields))
            return (state, false)
        } catch { return (state, true) }
    }

    private static func validateProfileState(_ state: StoredProfileState, credentials: [String: CredentialStoredValue]) throws {
        try validateProfiles(state.profiles)
        guard activationIsValid(state, credentials: credentials) else { throw TransportProtocolError.invalidProfileState }
    }

    static func validateProfiles(_ profiles: [StoredProviderProfile]) throws {
        guard profiles.count <= 1024 else { throw TransportProtocolError.invalidProfileState }
        var identities = Set<String>()
        for profile in profiles {
            try validateIdentity(profile.profileId)
            guard identities.insert(profile.profileId).inserted, (1...maximumRevision).contains(profile.revision),
                  !profile.displayName.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
                  profile.displayName.utf16.count <= 128, profile.endpoint.utf16.count <= 8192, (profile.model?.utf16.count ?? 0) <= 1024,
                  ["openai", "claude", "deepseek", "ollama"].contains(profile.kind),
                  let proxyMode = profile.proxyMode, ["system", "direct"].contains(proxyMode),
                  let model = profile.model, !model.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
                  profile.capability == nil || ["strict-json-schema", "json-object", "prompt-json"].contains(profile.capability!),
                  profile.endpoint == profile.endpoint.trimmingCharacters(in: .whitespacesAndNewlines),
                  let url = URLComponents(string: profile.endpoint), let scheme = url.scheme?.lowercased(), ["http", "https"].contains(scheme),
                  let host = url.host, !host.isEmpty, url.user == nil, url.password == nil, url.query == nil, url.fragment == nil,
                  url.port == nil || (1...65535).contains(url.port!)
            else { throw TransportProtocolError.invalidProfileState }
            if profile.kind == "claude" && profile.endpoint.range(of: #"/v1/(messages|models)/?$"#, options: [.regularExpression, .caseInsensitive]) != nil { throw TransportProtocolError.invalidProfileState }
            let bytes = try JSONSerialization.data(withJSONObject: ["kind": profile.kind, "endpoint": profile.endpoint, "proxyMode": proxyMode], options: [.sortedKeys, .withoutEscapingSlashes])
            guard profile.endpointFingerprint == CredentialCryptography.digest(bytes) else { throw TransportProtocolError.invalidProfileState }
        }
    }

    private static func activationIsValid(_ state: StoredProfileState, credentials: [String: CredentialStoredValue], unknown: Set<String> = []) -> Bool {
        guard let activation = state.activation else { return true }
        guard let profile = state.profiles.first(where: { $0.profileId == activation.profileId }), activation.profileRevision == profile.revision,
              activation.kind == profile.kind, activation.endpointFingerprint == profile.endpointFingerprint else { return false }
        return activation.credentialConfigured == (credentials[profile.profileId] != nil || unknown.contains(profile.profileId))
    }

    private static func validateIdentity(_ value: String) throws {
        guard UUID(uuidString: value) != nil else { throw TransportProtocolError.invalidRequest }
    }
    private static func validDigest(_ value: String) -> Bool { value.range(of: #"^[0-9a-f]{64}$"#, options: .regularExpression) != nil }
    private static func nextRevision(_ value: Int) throws -> Int {
        guard value < maximumRevision else { throw TransportProtocolError.credentialStoreUnavailable }
        return value + 1
    }
    private static func stateDigest(_ value: StoredProfileState) throws -> String {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys, .withoutEscapingSlashes]
        return CredentialCryptography.digest(try encoder.encode(value))
    }
    private static var nowMs: Int64 { Int64(Date().timeIntervalSince1970 * 1000) }
    private static func checkDeadline(_ deadlineMs: Int64) throws {
        guard nowMs < deadlineMs else { throw TransportProtocolError.credentialStoreUnavailable }
    }
    private static func recoveryDigest() -> String {
        CredentialCryptography.digest(Data("{\"action\":\"recover\",\"profileState\":{\"activation\":null,\"profiles\":[]}}".utf8))
    }
}
