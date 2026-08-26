import Darwin
import Foundation

protocol CredentialStoreAccess: Sendable {
    func read(profileID: String) async throws -> [String: String]?
    func write(profileID: String, fields: [String: String]) async throws
    func delete(profileID: String) async throws
}

/// Stores provider credentials in one fixed plugin-private JSON file.
///
/// The file is local plaintext protected by the plugin data directory and POSIX
/// permissions. Atomic writes create each replacement with mode 0600 before rename.
actor SecureCredentialStore: CredentialStoreAccess {
    private struct Document: Codable {
        let formatVersion: Int
        var credentials: [String: [String: String]]
    }

    private static let maximumFileBytes = 1_048_576
    private let directory: URL
    private let file: URL

    init(directory: URL) throws {
        guard directory.isFileURL, directory.path.hasPrefix("/") else {
            throw TransportProtocolError.invalidRequest
        }
        self.directory = directory.standardizedFileURL
        self.file = directory.appendingPathComponent("credentials.json", isDirectory: false)
        try FileManager.default.createDirectory(
            at: self.directory,
            withIntermediateDirectories: true,
            attributes: [.posixPermissions: 0o700]
        )
        guard chmod(self.directory.path, 0o700) == 0 else {
            throw TransportProtocolError.credentialStoreUnavailable
        }
    }

    func read(profileID: String) throws -> [String: String]? {
        try Self.validateProfileID(profileID)
        return try load().credentials[profileID]
    }

    func write(profileID: String, fields: [String: String]) throws {
        try Self.validateProfileID(profileID)
        try Self.validateFields(fields)
        var document = try load()
        document.credentials[profileID] = fields
        try persist(document)
    }

    func delete(profileID: String) throws {
        try Self.validateProfileID(profileID)
        var document = try load()
        guard document.credentials.removeValue(forKey: profileID) != nil else { return }
        try persist(document)
    }

    private static func validateProfileID(_ profileID: String) throws {
        guard UUID(uuidString: profileID) != nil else { throw TransportProtocolError.invalidRequest }
    }

    private static func validateFields(_ fields: [String: String]) throws {
        guard fields.count == 1,
              let apiKey = fields["apiKey"],
              !apiKey.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
              apiKey.utf8.count <= 8_192
        else { throw TransportProtocolError.invalidRequest }
    }

    private func load() throws -> Document {
        guard FileManager.default.fileExists(atPath: file.path) else {
            return Document(formatVersion: 1, credentials: [:])
        }
        let descriptor = open(file.path, O_RDONLY | O_NOFOLLOW)
        guard descriptor >= 0 else { throw TransportProtocolError.credentialStoreUnavailable }
        defer { close(descriptor) }

        var status = stat()
        guard fstat(descriptor, &status) == 0,
              status.st_uid == geteuid(),
              status.st_mode & S_IFMT == S_IFREG,
              status.st_size >= 0,
              status.st_size <= Self.maximumFileBytes,
              fchmod(descriptor, 0o600) == 0
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
            let document = try JSONDecoder().decode(Document.self, from: data)
            guard document.formatVersion == 1 else {
                throw TransportProtocolError.credentialStoreUnavailable
            }
            for (profileID, fields) in document.credentials {
                try Self.validateProfileID(profileID)
                try Self.validateFields(fields)
            }
            return document
        } catch let error as TransportProtocolError {
            throw error
        } catch {
            throw TransportProtocolError.credentialStoreUnavailable
        }
    }

    private func persist(_ document: Document) throws {
        let data: Data
        do {
            data = try JSONEncoder().encode(document)
        } catch {
            throw TransportProtocolError.credentialStoreUnavailable
        }
        guard data.count <= Self.maximumFileBytes else {
            throw TransportProtocolError.credentialStoreUnavailable
        }

        let temporary = directory.appendingPathComponent(".credentials-\(UUID().uuidString).tmp")
        let descriptor = open(
            temporary.path,
            O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW,
            mode_t(S_IRUSR | S_IWUSR)
        )
        guard descriptor >= 0 else { throw TransportProtocolError.credentialStoreUnavailable }
        var shouldDeleteTemporary = true
        defer {
            close(descriptor)
            if shouldDeleteTemporary { unlink(temporary.path) }
        }

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
        guard wroteAll, fchmod(descriptor, 0o600) == 0, fsync(descriptor) == 0 else {
            throw TransportProtocolError.credentialStoreUnavailable
        }
        guard rename(temporary.path, file.path) == 0 else {
            throw TransportProtocolError.credentialStoreUnavailable
        }
        shouldDeleteTemporary = false
    }
}
