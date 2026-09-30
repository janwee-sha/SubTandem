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
    func readCredential(profileID: String, expectedProfileRevision: Int) async throws -> Data?
    func confirmSave(commitID: String, expectedStoreRevision: Int, requestDigest: String) async throws -> ProfileStoreSnapshot?
    func saveProfile(_ input: CredentialProfileSave, value: Data) async throws -> ProfileStoreSnapshot
    func readProfileState() async throws -> ProfileStoreSnapshot
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

    init(directory: URL, protection: CredentialProtection = CredentialProtection(), fault: @escaping @Sendable (CredentialPersistStage) -> Bool = { _ in false }) throws {
        guard directory.isFileURL, directory.path.hasPrefix("/") else { throw TransportProtocolError.invalidRequest }
        self.directory = directory.standardizedFileURL
        self.file = self.directory.appendingPathComponent("credentials.json")
        self.lockFile = self.directory.appendingPathComponent(".credentials.lock")
        self.protection = protection
        self.fault = fault
        try FileManager.default.createDirectory(at: self.directory, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
        let directoryFD = open(self.directory.path, O_RDONLY | O_DIRECTORY | O_NOFOLLOW)
        guard directoryFD >= 0 else { throw TransportProtocolError.credentialStoreUnavailable }
        defer { close(directoryFD) }
        var status = stat()
        guard fstat(directoryFD, &status) == 0, status.st_uid == geteuid(), status.st_mode & S_IFMT == S_IFDIR,
              fchmod(directoryFD, 0o700) == 0 else { throw TransportProtocolError.credentialStoreUnavailable }
        let descriptor = open(self.lockFile.path, O_RDWR | O_CREAT | O_NOFOLLOW, mode_t(S_IRUSR | S_IWUSR))
        guard descriptor >= 0 else { throw TransportProtocolError.credentialStoreUnavailable }
        defer { close(descriptor) }
        try Self.validateOwnedRegularFile(descriptor)
    }

    func readProfileState() throws -> ProfileStoreSnapshot {
        try withLock { snapshot(try load()) }
    }

    func readCredential(profileID: String, expectedProfileRevision: Int) throws -> Data? {
        try Self.validateIdentity(profileID)
        return try withLock {
            let document = try load()
            guard let profile = document.profileState?.profiles.first(where: { $0.profileId == profileID }), profile.revision == expectedProfileRevision
            else { throw TransportProtocolError.profileStateConflict }
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
            document.profileState = input.profileState
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

    private func withLock<T>(_ operation: () throws -> T) throws -> T {
        let descriptor = open(lockFile.path, O_RDWR | O_CREAT | O_NOFOLLOW, mode_t(S_IRUSR | S_IWUSR))
        guard descriptor >= 0 else { throw TransportProtocolError.credentialStoreUnavailable }
        defer { close(descriptor) }
        try Self.validateOwnedRegularFile(descriptor)
        while flock(descriptor, LOCK_EX) != 0 {
            if errno != EINTR { throw TransportProtocolError.credentialStoreUnavailable }
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
        guard fstat(descriptor, &status) == 0, status.st_size > 0, status.st_size <= Self.maximumFileBytes else { throw TransportProtocolError.credentialStoreUnavailable }
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
        do {
            let object = try CredentialWire.record(JSONSerialization.jsonObject(with: data), keys: ["formatVersion", "storeId", "storeRevision", "profileState", "keyRing", "credentials", "lastCommit", "migration"])
            guard try CredentialWire.integer(object["formatVersion"]) == 2 else { throw TransportProtocolError.credentialStoreUnavailable }
            let document = try JSONDecoder().decode(Document.self, from: data)
            try Self.validateIdentity(document.storeId)
            guard (1...Self.maximumRevision).contains(document.storeRevision), let state = document.profileState else { throw TransportProtocolError.credentialStoreUnavailable }
            try Self.validateProfileFields(object["profileState"])
            try Self.validateProfiles(state.profiles)
            let identities = Set(state.profiles.map(\.profileId))
            guard Set(document.credentials.keys).isSubset(of: identities) else { throw TransportProtocolError.credentialStoreUnavailable }
            for (id, value) in document.credentials {
                try Self.validateIdentity(id)
                try Self.validateIdentity(value.credentialID)
                guard value.envelope.utf8.count <= 4 * ((CredentialWire.sealedBytes + 2) / 3) else { throw TransportProtocolError.credentialStoreUnavailable }
                _ = try CredentialWire.record((object["credentials"] as? [String: Any])?[id] as Any, keys: ["credentialId", "envelope"])
            }
            for (id, slot) in document.keyRing {
                try Self.validateIdentity(id)
                guard slot.keyID == id, slot.wrappedRepresentation.utf8.count <= 4 * ((16384 + 2) / 3) else { throw TransportProtocolError.credentialStoreUnavailable }
                _ = try CredentialWire.record((object["keyRing"] as? [String: Any])?[id] as Any, keys: ["keyId", "wrappedRepresentation"])
            }
            guard let receipt = document.lastCommit, ["open", "initialize", "commit", "save-profile", "migrate", "cleanup"].contains(receipt.operation), receipt.baseRevision >= 0, receipt.baseRevision == document.storeRevision - 1, Self.validDigest(receipt.requestDigest)
            else { throw TransportProtocolError.credentialStoreUnavailable }
            try Self.validateIdentity(receipt.commitId)
            _ = try CredentialWire.record(object["lastCommit"] as Any, keys: ["commitId", "operation", "baseRevision", "requestDigest"])
            return document
        } catch { throw TransportProtocolError.credentialStoreUnavailable }
    }

    private func snapshot(_ document: Document) -> ProfileStoreSnapshot {
        let configured = Dictionary(uniqueKeysWithValues: (document.profileState?.profiles ?? []).map { ($0.profileId, document.credentials[$0.profileId] != nil) })
        var state = document.profileState
        let invalid = state.map { !Self.activationIsValid($0, credentials: document.credentials) } ?? false
        if invalid { state?.activation = nil }
        return ProfileStoreSnapshot(initialized: state != nil, storeRevision: document.storeRevision, lastCommit: document.lastCommit, profileState: state, credentialConfigured: configured, invalidActivation: invalid ? true : nil)
    }

    private func persist(_ document: Document) throws {
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
        try data.withUnsafeBytes { buffer in
            guard let address = buffer.baseAddress else { throw TransportProtocolError.credentialStoreUnavailable }
            var offset = 0
            while offset < data.count {
                let count = Darwin.write(descriptor, address.advanced(by: offset), data.count - offset)
                if count < 0 && errno == EINTR { continue }
                guard count > 0 else { throw TransportProtocolError.credentialStoreUnavailable }
                offset += count
            }
        }
        if fault(.beforeFsync) { throw TransportProtocolError.credentialStoreUnavailable }
        guard fsync(descriptor) == 0 else { throw TransportProtocolError.credentialStoreUnavailable }
        if fault(.beforeRename) { throw TransportProtocolError.credentialStoreUnavailable }
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
        guard fstat(descriptor, &status) == 0, status.st_uid == geteuid(), status.st_mode & S_IFMT == S_IFREG, status.st_nlink == 1, fchmod(descriptor, 0o600) == 0 else { throw TransportProtocolError.credentialStoreUnavailable }
    }

    private static func validateProfileFields(_ value: Any?) throws {
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

    private static func validateProfileState(_ state: StoredProfileState, credentials: [String: CredentialStoredValue]) throws {
        try validateProfiles(state.profiles)
        guard activationIsValid(state, credentials: credentials) else { throw TransportProtocolError.invalidProfileState }
    }

    private static func validateProfiles(_ profiles: [StoredProviderProfile]) throws {
        var identities = Set<String>()
        for profile in profiles {
            try validateIdentity(profile.profileId)
            guard identities.insert(profile.profileId).inserted, (1...maximumRevision).contains(profile.revision),
                  !profile.displayName.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
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

    private static func activationIsValid(_ state: StoredProfileState, credentials: [String: CredentialStoredValue]) -> Bool {
        guard let activation = state.activation else { return true }
        guard let profile = state.profiles.first(where: { $0.profileId == activation.profileId }), activation.profileRevision == profile.revision,
              activation.kind == profile.kind, activation.endpointFingerprint == profile.endpointFingerprint else { return false }
        return activation.credentialConfigured == (credentials[profile.profileId] != nil)
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
}
