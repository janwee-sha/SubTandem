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
}

protocol CredentialStoreAccess: Sendable {
    func read(profileID: String) async throws -> [String: String]?
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
    func write(
        profileID: String,
        fields: [String: String],
        commitID: String,
        expectedStoreRevision: Int,
        expectedProfileRevision: Int
    ) async throws -> ProfileStoreSnapshot
}

actor SecureCredentialStore: CredentialStoreAccess {
    private struct Document: Codable {
        let formatVersion: Int
        var credentials: [String: [String: String]]
        var storeRevision: Int
        var lastCommit: StoredCommitReceipt?
        var profileState: StoredProfileState?

        enum CodingKeys: String, CodingKey {
            case formatVersion
            case credentials
            case storeRevision
            case lastCommit
            case profileState
        }

        init(
            formatVersion: Int = 1,
            credentials: [String: [String: String]],
            storeRevision: Int = 0,
            lastCommit: StoredCommitReceipt? = nil,
            profileState: StoredProfileState? = nil
        ) {
            self.formatVersion = formatVersion
            self.credentials = credentials
            self.storeRevision = storeRevision
            self.lastCommit = lastCommit
            self.profileState = profileState
        }

        init(from decoder: Decoder) throws {
            let container = try decoder.container(keyedBy: CodingKeys.self)
            formatVersion = try container.decode(Int.self, forKey: .formatVersion)
            credentials = try container.decode([String: [String: String]].self, forKey: .credentials)
            storeRevision = try container.decodeIfPresent(Int.self, forKey: .storeRevision) ?? 0
            lastCommit = try container.decodeIfPresent(StoredCommitReceipt.self, forKey: .lastCommit)
            profileState = try container.decodeIfPresent(StoredProfileState.self, forKey: .profileState)
        }
    }

    private struct LoadedDocument {
        var document: Document
        let invalidActivation: Bool
    }

    private static let maximumFileBytes = 1_048_576
    private let directory: URL
    private let file: URL
    private let lockFile: URL
    private let temporaryFile: URL
    private let fault: @Sendable (CredentialPersistStage) -> Bool

    init(
        directory: URL,
        fault: @escaping @Sendable (CredentialPersistStage) -> Bool = { _ in false }
    ) throws {
        guard directory.isFileURL, directory.path.hasPrefix("/") else {
            throw TransportProtocolError.invalidRequest
        }
        self.directory = directory.standardizedFileURL
        self.file = self.directory.appendingPathComponent("credentials.json", isDirectory: false)
        self.lockFile = self.directory.appendingPathComponent(".credentials.lock", isDirectory: false)
        self.temporaryFile = self.directory.appendingPathComponent(".credentials.tmp", isDirectory: false)
        self.fault = fault
        try FileManager.default.createDirectory(
            at: self.directory,
            withIntermediateDirectories: true,
            attributes: [.posixPermissions: 0o700]
        )
        guard chmod(self.directory.path, 0o700) == 0 else {
            throw TransportProtocolError.credentialStoreUnavailable
        }
        let descriptor = open(
            self.lockFile.path,
            O_RDWR | O_CREAT | O_NOFOLLOW,
            mode_t(S_IRUSR | S_IWUSR)
        )
        guard descriptor >= 0 else { throw TransportProtocolError.credentialStoreUnavailable }
        defer { close(descriptor) }
        try Self.validateOwnedRegularFile(descriptor)
    }

    func read(profileID: String) throws -> [String: String]? {
        try Self.validateProfileID(profileID)
        return try withLock(exclusive: false) { try load().document.credentials[profileID] }
    }

    func readProfileState() throws -> ProfileStoreSnapshot {
        try withLock(exclusive: false) { try snapshot(for: load()) }
    }

    func openProfileState(commitID: String) throws -> ProfileStoreSnapshot {
        try Self.validateCommitID(commitID)
        return try withLock(exclusive: true) {
            let loaded = try load()
            var document = loaded.document
            if let receipt = document.lastCommit, receipt.commitId == commitID {
                guard receipt.operation == "open", receipt.requestDigest == Self.digest("open") else {
                    throw TransportProtocolError.profileStateConflict
                }
                return try snapshot(for: loaded)
            }
            guard document.profileState != nil else { return try snapshot(for: loaded) }
            let baseRevision = document.storeRevision
            document.storeRevision = try Self.nextRevision(baseRevision)
            document.lastCommit = StoredCommitReceipt(
                commitId: commitID,
                operation: "open",
                baseRevision: baseRevision,
                requestDigest: Self.digest("open")
            )
            try persist(document)
            return try snapshot(for: LoadedDocument(document: document, invalidActivation: false))
        }
    }

    func initializeProfileState(
        commitID: String,
        expectedStoreRevision: Int,
        profiles: [StoredProviderProfile]
    ) throws -> ProfileStoreSnapshot {
        let state = StoredProfileState(profiles: profiles, activation: nil)
        return try mutate(
            operation: "initialize",
            commitID: commitID,
            expectedStoreRevision: expectedStoreRevision,
            requestDigest: try Self.profileStateDigest(state)
        ) { document in
            guard document.profileState == nil else { throw TransportProtocolError.profileStateConflict }
            try Self.validateProfileState(state, credentials: document.credentials)
            document.profileState = state
        }
    }

    func commitProfileState(
        commitID: String,
        expectedStoreRevision: Int,
        profileState: StoredProfileState
    ) throws -> ProfileStoreSnapshot {
        try mutate(
            operation: "commit",
            commitID: commitID,
            expectedStoreRevision: expectedStoreRevision,
            requestDigest: try Self.profileStateDigest(profileState)
        ) { document in
            guard let previous = document.profileState else {
                throw TransportProtocolError.profileStateConflict
            }
            try Self.validateProfileState(profileState, credentials: document.credentials)
            let currentKinds = Dictionary(
                uniqueKeysWithValues: profileState.profiles.map { ($0.profileId, $0.kind) }
            )
            for profile in previous.profiles {
                if currentKinds[profile.profileId] != profile.kind {
                    document.credentials.removeValue(forKey: profile.profileId)
                }
            }
            document.profileState = profileState
        }
    }

    func write(
        profileID: String,
        fields: [String: String],
        commitID: String,
        expectedStoreRevision: Int,
        expectedProfileRevision: Int
    ) throws -> ProfileStoreSnapshot {
        try Self.validateProfileID(profileID)
        try Self.validateFields(fields)
        guard expectedProfileRevision > 0 else { throw TransportProtocolError.invalidRequest }
        let requestDigest = Self.digest(
            "credential-write\u{0}\(profileID)\u{0}\(expectedProfileRevision)"
        )
        return try mutate(
            operation: "credential-write",
            commitID: commitID,
            expectedStoreRevision: expectedStoreRevision,
            requestDigest: requestDigest,
            idempotentContentMatches: { $0.credentials[profileID] == fields }
        ) { document in
            guard let profile = document.profileState?.profiles.first(where: { $0.profileId == profileID }),
                  profile.revision == expectedProfileRevision
            else { throw TransportProtocolError.profileStateConflict }
            document.credentials[profileID] = fields
            if document.profileState?.activation?.profileId == profileID {
                document.profileState?.activation?.credentialConfigured = true
            }
        }
    }

    private func mutate(
        operation: String,
        commitID: String,
        expectedStoreRevision: Int,
        requestDigest: String,
        idempotentContentMatches: (Document) -> Bool = { _ in true },
        update: (inout Document) throws -> Void
    ) throws -> ProfileStoreSnapshot {
        try Self.validateCommitID(commitID)
        guard expectedStoreRevision >= 0 else { throw TransportProtocolError.invalidRequest }
        return try withLock(exclusive: true) {
            let loaded = try load()
            var document = loaded.document
            if let receipt = document.lastCommit, receipt.commitId == commitID {
                guard receipt.operation == operation,
                      receipt.baseRevision == expectedStoreRevision,
                      receipt.requestDigest == requestDigest,
                      idempotentContentMatches(document)
                else { throw TransportProtocolError.profileStateConflict }
                return try snapshot(for: loaded)
            }
            guard document.storeRevision == expectedStoreRevision else {
                throw TransportProtocolError.profileStateConflict
            }
            try update(&document)
            document.lastCommit = StoredCommitReceipt(
                commitId: commitID,
                operation: operation,
                baseRevision: expectedStoreRevision,
                requestDigest: requestDigest
            )
            document.storeRevision = try Self.nextRevision(expectedStoreRevision)
            try persist(document)
            return try snapshot(for: LoadedDocument(document: document, invalidActivation: false))
        }
    }

    private func withLock<T>(exclusive _: Bool, _ operation: () throws -> T) throws -> T {
        let descriptor = open(
            lockFile.path,
            O_RDWR | O_CREAT | O_NOFOLLOW,
            mode_t(S_IRUSR | S_IWUSR)
        )
        guard descriptor >= 0 else { throw TransportProtocolError.credentialStoreUnavailable }
        defer { close(descriptor) }
        try Self.validateOwnedRegularFile(descriptor)
        guard Darwin.lockf(descriptor, F_LOCK, 0) == 0 else {
            throw TransportProtocolError.credentialStoreUnavailable
        }
        defer { Darwin.lockf(descriptor, F_ULOCK, 0) }
        return try operation()
    }

    private func load() throws -> LoadedDocument {
        guard FileManager.default.fileExists(atPath: file.path) else {
            return LoadedDocument(document: Document(credentials: [:]), invalidActivation: false)
        }
        let descriptor = open(file.path, O_RDONLY | O_NOFOLLOW)
        guard descriptor >= 0 else { throw TransportProtocolError.credentialStoreUnavailable }
        defer { close(descriptor) }
        try Self.validateOwnedRegularFile(descriptor)
        var status = stat()
        guard fstat(descriptor, &status) == 0,
              status.st_size >= 0,
              status.st_size <= Self.maximumFileBytes
        else { throw TransportProtocolError.credentialStoreUnavailable }
        var data = Data()
        var buffer = [UInt8](repeating: 0, count: 16_384)
        while true {
            let count = Darwin.read(descriptor, &buffer, buffer.count)
            if count == 0 { break }
            guard count > 0 else { throw TransportProtocolError.credentialStoreUnavailable }
            data.append(buffer, count: count)
            guard data.count <= Self.maximumFileBytes else {
                throw TransportProtocolError.credentialStoreUnavailable
            }
        }
        do {
            try Self.validateDocumentKeys(data)
            let document = try JSONDecoder().decode(Document.self, from: data)
            guard document.formatVersion == 1, document.storeRevision >= 0 else {
                throw TransportProtocolError.credentialStoreUnavailable
            }
            for (profileID, fields) in document.credentials {
                try Self.validateProfileID(profileID)
                try Self.validateFields(fields)
            }
            if let receipt = document.lastCommit {
                try Self.validateReceipt(receipt, storeRevision: document.storeRevision)
            }
            var invalidActivation = false
            if let state = document.profileState {
                try Self.validateProfiles(state.profiles)
                invalidActivation = !Self.activationIsValid(state, credentials: document.credentials)
            }
            return LoadedDocument(document: document, invalidActivation: invalidActivation)
        } catch let error as TransportProtocolError {
            throw error
        } catch {
            throw TransportProtocolError.credentialStoreUnavailable
        }
    }

    private func snapshot(for loaded: LoadedDocument) throws -> ProfileStoreSnapshot {
        let credentials = loaded.document.credentials
        let configured = Dictionary(
            uniqueKeysWithValues: (loaded.document.profileState?.profiles ?? []).map {
                ($0.profileId, credentials[$0.profileId] != nil)
            }
        )
        var projected = loaded.document.profileState
        if loaded.invalidActivation { projected?.activation = nil }
        return ProfileStoreSnapshot(
            initialized: loaded.document.profileState != nil,
            storeRevision: loaded.document.storeRevision,
            lastCommit: loaded.document.lastCommit,
            profileState: projected,
            credentialConfigured: configured,
            invalidActivation: loaded.invalidActivation ? true : nil
        )
    }

    private func persist(_ document: Document) throws {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys]
        let data: Data
        do {
            data = try encoder.encode(document)
        } catch {
            throw TransportProtocolError.credentialStoreUnavailable
        }
        guard data.count <= Self.maximumFileBytes else {
            throw TransportProtocolError.credentialStoreUnavailable
        }
        try removeStaleTemporary()
        let descriptor = open(
            temporaryFile.path,
            O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW,
            mode_t(S_IRUSR | S_IWUSR)
        )
        guard descriptor >= 0 else { throw TransportProtocolError.credentialStoreUnavailable }
        var shouldDeleteTemporary = true
        defer {
            close(descriptor)
            if shouldDeleteTemporary { unlink(temporaryFile.path) }
        }
        if fault(.beforeWrite) { throw TransportProtocolError.credentialStoreUnavailable }
        let wroteAll = data.withUnsafeBytes { rawBuffer -> Bool in
            guard var address = rawBuffer.baseAddress else { return data.isEmpty }
            var remaining = rawBuffer.count
            while remaining > 0 {
                let count = Darwin.write(descriptor, address, remaining)
                guard count > 0 else { return false }
                remaining -= count
                address = address.advanced(by: count)
            }
            return true
        }
        guard wroteAll, fchmod(descriptor, 0o600) == 0 else {
            throw TransportProtocolError.credentialStoreUnavailable
        }
        if fault(.beforeFsync) { throw TransportProtocolError.credentialStoreUnavailable }
        guard fsync(descriptor) == 0 else { throw TransportProtocolError.credentialStoreUnavailable }
        if fault(.beforeRename) { throw TransportProtocolError.credentialStoreUnavailable }
        guard rename(temporaryFile.path, file.path) == 0 else {
            throw TransportProtocolError.credentialStoreUnavailable
        }
        shouldDeleteTemporary = false
    }

    private func removeStaleTemporary() throws {
        var status = stat()
        guard lstat(temporaryFile.path, &status) == 0 else {
            if errno == ENOENT { return }
            throw TransportProtocolError.credentialStoreUnavailable
        }
        guard status.st_uid == geteuid(), status.st_mode & S_IFMT == S_IFREG else {
            throw TransportProtocolError.credentialStoreUnavailable
        }
        guard unlink(temporaryFile.path) == 0 else {
            throw TransportProtocolError.credentialStoreUnavailable
        }
    }

    private static func validateOwnedRegularFile(_ descriptor: Int32) throws {
        var status = stat()
        guard fstat(descriptor, &status) == 0,
              status.st_uid == geteuid(),
              status.st_mode & S_IFMT == S_IFREG,
              fchmod(descriptor, 0o600) == 0
        else { throw TransportProtocolError.credentialStoreUnavailable }
    }

    private static func validateDocumentKeys(_ data: Data) throws {
        guard let object = try JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            throw TransportProtocolError.credentialStoreUnavailable
        }
        let allowed = Set(["formatVersion", "credentials", "storeRevision", "lastCommit", "profileState"])
        guard Set(object.keys).isSubset(of: allowed),
              object["formatVersion"] != nil,
              object["credentials"] != nil
        else { throw TransportProtocolError.credentialStoreUnavailable }
    }

    private static func validateProfileState(
        _ state: StoredProfileState,
        credentials: [String: [String: String]]
    ) throws {
        try validateProfiles(state.profiles)
        guard activationIsValid(state, credentials: credentials) else {
            throw TransportProtocolError.invalidProfileState
        }
    }

    private static func validateProfiles(_ profiles: [StoredProviderProfile]) throws {
        var identities = Set<String>()
        for profile in profiles {
            try validateProfileID(profile.profileId)
            guard identities.insert(profile.profileId).inserted,
                  profile.revision > 0,
                  !profile.displayName.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
                  ["openai", "claude", "deepseek", "ollama"].contains(profile.kind),
                  !profile.endpoint.isEmpty,
                  !profile.endpointFingerprint.isEmpty,
                  profile.proxyMode == nil || profile.proxyMode == "system" || profile.proxyMode == "direct",
                  let model = profile.model,
                  !model.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
                  profile.capability == nil || ["strict-json-schema", "json-object", "prompt-json"].contains(profile.capability!)
            else { throw TransportProtocolError.invalidProfileState }
        }
    }

    private static func activationIsValid(
        _ state: StoredProfileState,
        credentials: [String: [String: String]]
    ) -> Bool {
        guard let activation = state.activation else { return true }
        guard let profile = state.profiles.first(where: { $0.profileId == activation.profileId }),
              activation.profileRevision == profile.revision,
              activation.kind == profile.kind,
              activation.endpointFingerprint == profile.endpointFingerprint
        else { return false }
        let configured = credentials[profile.profileId] != nil
        return activation.credentialConfigured == configured && (profile.kind != "claude" || configured)
    }

    private static func validateReceipt(_ receipt: StoredCommitReceipt, storeRevision: Int) throws {
        try validateCommitID(receipt.commitId)
        guard ["open", "initialize", "commit", "credential-write"].contains(receipt.operation),
              receipt.baseRevision >= 0,
              receipt.baseRevision < storeRevision,
              !receipt.requestDigest.isEmpty
        else { throw TransportProtocolError.credentialStoreUnavailable }
    }

    private static func validateProfileID(_ profileID: String) throws {
        guard UUID(uuidString: profileID) != nil else { throw TransportProtocolError.invalidRequest }
    }

    private static func validateCommitID(_ commitID: String) throws {
        guard UUID(uuidString: commitID) != nil else { throw TransportProtocolError.invalidRequest }
    }

    private static func validateFields(_ fields: [String: String]) throws {
        guard fields.count == 1,
              let apiKey = fields["apiKey"],
              !apiKey.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
              apiKey.utf8.count <= 8_192
        else { throw TransportProtocolError.invalidRequest }
    }

    private static func nextRevision(_ revision: Int) throws -> Int {
        guard revision < Int.max else { throw TransportProtocolError.credentialStoreUnavailable }
        return revision + 1
    }

    private static func profileStateDigest(_ state: StoredProfileState) throws -> String {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys]
        return digest(String(decoding: try encoder.encode(state), as: UTF8.self))
    }

    private static func digest(_ value: String) -> String {
        var result: UInt64 = 14_695_981_039_346_656_037
        for byte in value.utf8 {
            result ^= UInt64(byte)
            result &*= 1_099_511_628_211
        }
        return String(result, radix: 16)
    }
}
