import Darwin
import Foundation

enum CredentialMigrationFailure: Error {
    case required(String)
    case notCommitted
    case unconfirmed
}

enum CredentialCleanupStage: Sendable, CaseIterable {
    case beforeUnlink
    case afterUnlink
    case beforeRmdir
    case afterRmdir
    case beforeDirectoryFsync
    case afterDirectoryFsync
    case beforeRescan
}

struct LegacyCredentialMetadata {
    let sourceLayout: String
    let storeRevision: Int
    let profileState: StoredProfileState?
}

struct CredentialMigration {
    static let classes = ["legacy-credentials", "legacy-rpc", "legacy-mailbox", "legacy-preferences"]
    let directory: URL
    let mailboxDirectory: URL?
    let preferenceFile: URL?
    let fault: @Sendable (CredentialCleanupStage, String) -> Bool

    static func legacy(_ data: Data) throws -> LegacyCredentialMetadata? {
        guard let object = try JSONSerialization.jsonObject(with: data) as? [String: Any],
              let version = try? CredentialWire.integer(object["formatVersion"])
        else { throw TransportProtocolError.credentialStoreUnavailable }
        if version == 2 { return nil }
        guard version == 1, Set(object.keys).isSubset(of: ["formatVersion", "credentials", "storeRevision", "lastCommit", "profileState"])
        else { throw TransportProtocolError.credentialStoreUnavailable }
        let revision = object["storeRevision"] == nil ? 0 : Int(try CredentialWire.integer(object["storeRevision"]))
        guard revision < 9_007_199_254_740_991 else { throw TransportProtocolError.credentialStoreUnavailable }
        guard let rawState = object["profileState"], !(rawState is NSNull) else {
            guard let credentials = object["credentials"] as? [String: [String: String]] else { throw TransportProtocolError.credentialStoreUnavailable }
            for (id, fields) in credentials {
                guard UUID(uuidString: id) != nil, Set(fields.keys).isSubset(of: ["apiKey"]), fields.values.allSatisfy({ $0.utf8.count <= CredentialWire.keyBytes }) else { throw TransportProtocolError.credentialStoreUnavailable }
            }
            return LegacyCredentialMetadata(sourceLayout: "credentials-only", storeRevision: revision, profileState: nil)
        }
        guard var state = rawState as? [String: Any], Set(state.keys).isSubset(of: ["profiles", "activation"]) else { throw TransportProtocolError.invalidProfileState }
        if state["activation"] == nil { state["activation"] = NSNull() }
        var decoded = try SecureCredentialStore.projectProfileState(state).state
        if var activation = decoded.activation {
            if let profile = decoded.profiles.first(where: { $0.profileId == activation.profileId }),
               profile.revision == activation.profileRevision, profile.kind == activation.kind, profile.endpointFingerprint == activation.endpointFingerprint {
                activation.credentialConfigured = false
                decoded.activation = activation
            } else { decoded.activation = nil }
        }
        return LegacyCredentialMetadata(sourceLayout: "profile-state", storeRevision: revision, profileState: decoded)
    }

    static func validate(_ state: CredentialMigrationState) throws {
        guard UUID(uuidString: state.migrationId) != nil, state.sourceFormat == 1,
              ["profile-state", "credentials-only"].contains(state.sourceLayout), state.commitState == "committed",
              ["pending", "clean"].contains(state.cleanupState), Set(state.pendingClasses).count == state.pendingClasses.count,
              Set(state.pendingClasses).isSubset(of: Set(classes)), (state.cleanupState == "clean") == state.pendingClasses.isEmpty
        else { throw TransportProtocolError.credentialStoreUnavailable }
    }

    func cleanup(_ pending: [String], preferenceConfirmed: Bool) -> [String] {
        do { try stopLegacyWriters() } catch { return pending }
        var failures = Set<String>()
        for category in Self.classes {
            do {
                switch category {
                case "legacy-credentials": try cleanData()
                case "legacy-rpc": try cleanRPC()
                case "legacy-mailbox": try cleanMailbox()
                default:
                    if pending.contains(category) { try cleanPreferences(preferenceConfirmed) }
                }
            } catch { failures.insert(category) }
        }
        return Self.classes.filter { failures.contains($0) }
    }

    private func cleanData() throws {
        try withDirectory(directory) { descriptor, names in
            for name in names where Self.matches(name, #"^(\.credentials\.tmp|\.credentials-[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}\.tmp|\.credentials\.json\.activation-backup-[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}|\.credentials\.json\.activation-fixture-[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}\.tmp)$"#) {
                try removeFile(name, descriptor: descriptor, directory: directory)
            }
            try synchronize(descriptor, directory)
            try rescan(directory, predicate: { Self.matches($0, #"^(\.credentials\.tmp|\.credentials-[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}\.tmp|\.credentials\.json\.activation-backup-[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}|\.credentials\.json\.activation-fixture-[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}\.tmp)$"#) })
        }
    }

    private func cleanRPC() throws {
        let rpc = directory.appendingPathComponent(".rpc")
        if try ownedDirectoryExists(rpc) {
            try withDirectory(rpc) { descriptor, names in
                for name in names {
                    if Self.oldRPCFile(name) { try removeFile(name, descriptor: descriptor, directory: rpc) }
                    else if Self.oldSession(name) {
                        let session = rpc.appendingPathComponent(name)
                        try withDirectory(session) { sessionFD, entries in
                            for entry in entries where Self.oldRPCFile(entry) || Self.matches(entry, #"^\.[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}\.tmp$"#) {
                                try removeFile(entry, descriptor: sessionFD, directory: session)
                            }
                            try synchronize(sessionFD, session)
                            try rescan(session, predicate: { Self.oldRPCFile($0) || Self.matches($0, #"^\.[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}\.tmp$"#) })
                            if try FileManager.default.contentsOfDirectory(atPath: session.path).isEmpty {
                                try inject(.beforeRmdir, session)
                                var status = stat()
                                var opened = stat()
                                guard fstatat(descriptor, name, &status, AT_SYMLINK_NOFOLLOW) == 0, fstat(sessionFD, &opened) == 0,
                                      status.st_dev == opened.st_dev, status.st_ino == opened.st_ino,
                                      unlinkat(descriptor, name, AT_REMOVEDIR) == 0 else { throw CredentialMigrationFailure.notCommitted }
                                try inject(.afterRmdir, session)
                            }
                        }
                    }
                }
                try synchronize(descriptor, rpc)
                try rescan(rpc, predicate: Self.oldRPCFile)
            }
        }
        try withDirectory(directory) { descriptor, _ in try synchronize(descriptor, directory) }
    }

    private func cleanMailbox() throws {
        guard let mailboxDirectory else { throw CredentialMigrationFailure.notCommitted }
        let pattern = #"^subtandem-mailbox-v1-(request|response)-[0-9a-f]+-[0-9a-z]+-[0-9a-z]+-[0-9a-z]+\.(json|ready|secrets\.json)$"#
        if try ownedDirectoryExists(mailboxDirectory) {
            try withDirectory(mailboxDirectory) { descriptor, names in
                for name in names where Self.matches(name, pattern) { try removeFile(name, descriptor: descriptor, directory: mailboxDirectory) }
                try synchronize(descriptor, mailboxDirectory)
                try rescan(mailboxDirectory, predicate: { Self.matches($0, pattern) })
            }
        }
        let parent = mailboxDirectory.deletingLastPathComponent()
        try withDirectory(parent) { descriptor, _ in try synchronize(descriptor, parent) }
    }

    private func cleanPreferences(_ confirmed: Bool) throws {
        guard confirmed, let preferenceFile else { throw CredentialMigrationFailure.notCommitted }
        let parent = preferenceFile.deletingLastPathComponent()
        try withDirectory(parent) { directoryFD, _ in
            let descriptor = openat(directoryFD, preferenceFile.lastPathComponent, O_RDONLY | O_NOFOLLOW)
            if descriptor < 0 {
                guard errno == ENOENT else { throw CredentialMigrationFailure.notCommitted }
                try synchronize(directoryFD, parent)
                try inject(.beforeRescan, preferenceFile)
                var status = stat()
                guard fstatat(directoryFD, preferenceFile.lastPathComponent, &status, AT_SYMLINK_NOFOLLOW) != 0, errno == ENOENT else { throw CredentialMigrationFailure.notCommitted }
                return
            }
            defer { close(descriptor) }
            try validatePreference(descriptor)
            guard fsync(descriptor) == 0 else { throw CredentialMigrationFailure.notCommitted }
            try synchronize(directoryFD, parent)
            try inject(.beforeRescan, preferenceFile)
            try validatePreference(descriptor)
            var opened = stat()
            var path = stat()
            guard fstat(descriptor, &opened) == 0, fstatat(directoryFD, preferenceFile.lastPathComponent, &path, AT_SYMLINK_NOFOLLOW) == 0,
                  opened.st_dev == path.st_dev, opened.st_ino == path.st_ino else { throw CredentialMigrationFailure.notCommitted }
        }
    }

    private func validatePreference(_ descriptor: Int32) throws {
        var status = stat()
        guard fstat(descriptor, &status) == 0, status.st_uid == geteuid(), status.st_mode & S_IFMT == S_IFREG, status.st_nlink == 1,
              status.st_size > 0, status.st_size <= 1_048_576, lseek(descriptor, 0, SEEK_SET) == 0 else { throw CredentialMigrationFailure.notCommitted }
        var bytes = [UInt8](repeating: 0, count: Int(status.st_size))
        let byteCount = bytes.count
        var offset = 0
        while offset < byteCount {
            let count = bytes.withUnsafeMutableBytes { read(descriptor, $0.baseAddress!.advanced(by: offset), byteCount - offset) }
            guard count > 0 else { throw CredentialMigrationFailure.notCommitted }
            offset += count
        }
        guard let values = try PropertyListSerialization.propertyList(from: Data(bytes), format: nil) as? [String: Any],
              values["providerProfilesJson"] == nil || (values["providerProfilesJson"] as? String) == "" else { throw CredentialMigrationFailure.notCommitted }
    }

    private func inject(_ stage: CredentialCleanupStage, _ url: URL) throws {
        if fault(stage, url.path) { throw CredentialMigrationFailure.notCommitted }
    }

    private func synchronize(_ descriptor: Int32, _ url: URL) throws {
        try inject(.beforeDirectoryFsync, url)
        guard fsync(descriptor) == 0 else { throw CredentialMigrationFailure.notCommitted }
        try inject(.afterDirectoryFsync, url)
    }

    private func removeFile(_ name: String, descriptor: Int32, directory: URL) throws {
        let path = directory.appendingPathComponent(name)
        try inject(.beforeUnlink, path)
        var status = stat()
        guard fstatat(descriptor, name, &status, AT_SYMLINK_NOFOLLOW) == 0, status.st_uid == geteuid(), status.st_mode & S_IFMT == S_IFREG, status.st_nlink == 1,
              unlinkat(descriptor, name, 0) == 0 else { throw CredentialMigrationFailure.notCommitted }
        try inject(.afterUnlink, path)
    }

    private func rescan(_ url: URL, predicate: (String) -> Bool) throws {
        try inject(.beforeRescan, url)
        guard try !FileManager.default.contentsOfDirectory(atPath: url.path).contains(where: predicate) else { throw CredentialMigrationFailure.notCommitted }
    }

    private func ownedDirectoryExists(_ url: URL) throws -> Bool {
        var status = stat()
        if lstat(url.path, &status) != 0 {
            if errno == ENOENT { return false }
            throw CredentialMigrationFailure.notCommitted
        }
        guard status.st_uid == geteuid(), status.st_mode & S_IFMT == S_IFDIR else { throw CredentialMigrationFailure.notCommitted }
        return true
    }

    private func withDirectory(_ url: URL, operation: (Int32, [String]) throws -> Void) throws {
        let descriptor = open(url.path, O_RDONLY | O_DIRECTORY | O_NOFOLLOW)
        guard descriptor >= 0 else { throw CredentialMigrationFailure.notCommitted }
        defer { close(descriptor) }
        var status = stat()
        var pathStatus = stat()
        guard fstat(descriptor, &status) == 0, status.st_uid == geteuid(), status.st_mode & S_IFMT == S_IFDIR,
              lstat(url.path, &pathStatus) == 0, status.st_dev == pathStatus.st_dev, status.st_ino == pathStatus.st_ino else { throw CredentialMigrationFailure.notCommitted }
        let names = try FileManager.default.contentsOfDirectory(atPath: url.path)
        guard names.count <= 16_384 else { throw CredentialMigrationFailure.notCommitted }
        try operation(descriptor, names)
    }

    private static func matches(_ name: String, _ pattern: String) -> Bool { name.range(of: pattern, options: .regularExpression) != nil }
    private static func oldRPCFile(_ name: String) -> Bool { matches(name, #"^transport-[0-9a-z]+-[0-9a-z]+-[0-9a-z]+\.(request\.json|request\.ready|processing\.json|response\.json)$"#) }
    private static func oldSession(_ name: String) -> Bool { matches(name, #"^transport-[0-9a-z]+-[0-9a-z]+-[0-9a-z]+$"#) }

    private func stopLegacyWriters() throws {
        let count = proc_listallpids(nil, 0)
        guard count > 0, count < 16_384 else { throw CredentialMigrationFailure.notCommitted }
        var pids = [Int32](repeating: 0, count: Int(count) + 64)
        let populated = proc_listallpids(&pids, Int32(pids.count * MemoryLayout<Int32>.size))
        guard populated > 0, populated <= pids.count else { throw CredentialMigrationFailure.notCommitted }
        for pid in pids.prefix(Int(populated)) where pid > 1 && pid != getpid() {
            var info = proc_bsdinfo()
            guard proc_pidinfo(pid, PROC_PIDTBSDINFO, 0, &info, Int32(MemoryLayout<proc_bsdinfo>.size)) == MemoryLayout<proc_bsdinfo>.size,
                  info.pbi_uid == geteuid(), let arguments = Self.arguments(pid), let executable = arguments.first,
                  URL(fileURLWithPath: executable).lastPathComponent == "subtandem-transport",
                  let dataIndex = arguments.firstIndex(of: "--data-directory"), dataIndex + 1 < arguments.count,
                  URL(fileURLWithPath: arguments[dataIndex + 1]).standardizedFileURL == directory
            else { continue }
            let plugins = directory.deletingLastPathComponent().deletingLastPathComponent()
            let installed = plugins.appendingPathComponent("\(directory.lastPathComponent).iinaplugin/dist/native/subtandem-transport")
            guard URL(fileURLWithPath: executable).resolvingSymlinksInPath() == installed.resolvingSymlinksInPath() || executable == CommandLine.arguments[0] else { continue }
            var legacy = !arguments.contains("--rpc-session")
            if let index = arguments.firstIndex(of: "--rpc-session"), index + 1 < arguments.count {
                let session = arguments[index + 1]
                if Self.oldSession("transport-\(session)") { legacy = try ownedDirectoryExists(directory.appendingPathComponent(".rpc/transport-\(session)")) }
            }
            if !legacy, let index = arguments.firstIndex(of: "--ready-file"), index + 1 < arguments.count {
                let ready = URL(fileURLWithPath: arguments[index + 1]).standardizedFileURL
                if ready.deletingLastPathComponent() == directory.appendingPathComponent(".ready") { legacy = try Self.legacyReady(ready) }
            }
            guard legacy else { continue }
            guard Self.arguments(pid) == arguments else { throw CredentialMigrationFailure.notCommitted }
            if kill(pid, SIGTERM) != 0 && errno != ESRCH { throw CredentialMigrationFailure.notCommitted }
            var stopped = false
            for _ in 0..<100 {
                var current = proc_bsdinfo()
                if proc_pidinfo(pid, PROC_PIDTBSDINFO, 0, &current, Int32(MemoryLayout<proc_bsdinfo>.size)) <= 0 || current.pbi_status == SZOMB { stopped = true; break }
                usleep(10_000)
            }
            guard stopped else { throw CredentialMigrationFailure.notCommitted }
        }
    }

    private static func arguments(_ pid: Int32) -> [String]? {
        var mib = [CTL_KERN, KERN_PROCARGS2, pid]
        var size = 262_144
        var bytes = [UInt8](repeating: 0, count: size)
        guard sysctl(&mib, 3, &bytes, &size, nil, 0) == 0, size > 4 else { return nil }
        let argc = bytes.withUnsafeBytes { $0.load(as: Int32.self) }
        guard argc > 0, argc <= 64 else { return nil }
        var offset = 4
        while offset < size && bytes[offset] != 0 { offset += 1 }
        var result: [String] = []
        for _ in 0..<argc {
            while offset < size && bytes[offset] == 0 { offset += 1 }
            let start = offset
            while offset < size && bytes[offset] != 0 { offset += 1 }
            guard offset < size, let value = String(bytes: bytes[start..<offset], encoding: .utf8) else { return nil }
            result.append(value)
        }
        return result
    }

    private static func legacyReady(_ url: URL) throws -> Bool {
        let descriptor = open(url.path, O_RDONLY | O_NOFOLLOW)
        if descriptor < 0 { if errno == ENOENT { return false }; throw CredentialMigrationFailure.notCommitted }
        defer { close(descriptor) }
        var status = stat()
        guard fstat(descriptor, &status) == 0, status.st_uid == geteuid(), status.st_mode & S_IFMT == S_IFREG, status.st_size > 0, status.st_size <= 2048 else { throw CredentialMigrationFailure.notCommitted }
        var bytes = [UInt8](repeating: 0, count: Int(status.st_size))
        guard Darwin.read(descriptor, &bytes, bytes.count) == bytes.count,
              let frame = try JSONSerialization.jsonObject(with: Data(bytes)) as? [String: Any] else { throw CredentialMigrationFailure.notCommitted }
        return frame["protocolVersion"] as? Int == 1
    }
}
