import Darwin
import Foundation

enum DetachedBootstrapError: Error {
    case invalidParent
    case spawnFailed
    case startupFailed
    case startupTimedOut
}

enum DetachedBootstrap {
    static func daemonArguments(_ arguments: [String], parentPID: Int32) throws -> [String] {
        guard parentPID > 1 else { throw DetachedBootstrapError.invalidParent }
        return ["serve"] + arguments + ["--parent-pid", String(parentPID)]
    }

    static func launch(
        arguments: [String],
        readyFile: URL,
        parentPID: Int32 = getppid(),
        timeout: TimeInterval = 10
    ) throws {
        let executable = CommandLine.arguments[0]
        let values = [executable] + (try daemonArguments(arguments, parentPID: parentPID))
        let pointers = values.map { strdup($0) } + [nil]
        let environmentPointers = ProcessInfo.processInfo.environment
            .map { strdup("\($0.key)=\($0.value)") } + [nil]
        defer {
            pointers.compactMap { $0 }.forEach { free($0) }
            environmentPointers.compactMap { $0 }.forEach { free($0) }
        }
        var actions: posix_spawn_file_actions_t?
        var attributes: posix_spawnattr_t?
        guard posix_spawn_file_actions_init(&actions) == 0,
              posix_spawn_file_actions_addopen(&actions, STDIN_FILENO, "/dev/null", O_RDONLY, 0) == 0,
              posix_spawn_file_actions_addopen(&actions, STDOUT_FILENO, "/dev/null", O_WRONLY, 0) == 0,
              posix_spawn_file_actions_addopen(&actions, STDERR_FILENO, "/dev/null", O_WRONLY, 0) == 0,
              posix_spawnattr_init(&attributes) == 0,
              posix_spawnattr_setflags(&attributes, Int16(POSIX_SPAWN_SETSID)) == 0
        else { throw DetachedBootstrapError.spawnFailed }
        defer {
            posix_spawn_file_actions_destroy(&actions)
            posix_spawnattr_destroy(&attributes)
        }
        var processID: pid_t = 0
        let status = executable.withCString { path in
            pointers.withUnsafeBufferPointer { buffer in
                environmentPointers.withUnsafeBufferPointer { environmentBuffer in
                    posix_spawn(
                        &processID,
                        path,
                        &actions,
                        &attributes,
                        UnsafeMutablePointer(mutating: buffer.baseAddress),
                        UnsafeMutablePointer(mutating: environmentBuffer.baseAddress)
                    )
                }
            }
        }
        guard status == 0 else { throw DetachedBootstrapError.spawnFailed }
        let deadline = Date().addingTimeInterval(timeout)
        while Date() < deadline {
            if FileManager.default.fileExists(atPath: readyFile.path) { return }
            var childStatus: Int32 = 0
            if waitpid(processID, &childStatus, WNOHANG) == processID {
                throw DetachedBootstrapError.startupFailed
            }
            usleep(10_000)
        }
        kill(processID, SIGTERM)
        waitpid(processID, nil, 0)
        throw DetachedBootstrapError.startupTimedOut
    }
}

enum ReadyFileWriter {
    static func write(_ frame: ReadyFrame, to destination: URL) throws {
        let directory = destination.deletingLastPathComponent()
        try FileManager.default.createDirectory(
            at: directory,
            withIntermediateDirectories: true,
            attributes: [.posixPermissions: 0o700]
        )
        try FileManager.default.setAttributes(
            [.posixPermissions: 0o700],
            ofItemAtPath: directory.path
        )
        let temporary = directory.appendingPathComponent(".\(UUID().uuidString).tmp")
        var descriptor = open(temporary.path, O_WRONLY | O_CREAT | O_EXCL, S_IRUSR | S_IWUSR)
        guard descriptor >= 0 else { throw ProtocolError.invalid }
        defer {
            if descriptor >= 0 { close(descriptor) }
            unlink(temporary.path)
        }
        var data = try JSONEncoder().encode(frame)
        data.append(0x0a)
        try data.withUnsafeBytes { bytes in
            guard let baseAddress = bytes.baseAddress else { return }
            var offset = 0
            while offset < data.count {
                let count = Darwin.write(descriptor, baseAddress.advanced(by: offset), data.count - offset)
                if count < 0 && errno == EINTR { continue }
                guard count > 0 else { throw ProtocolError.invalid }
                offset += count
            }
        }
        guard fsync(descriptor) == 0 else { throw ProtocolError.invalid }
        let closeResult = close(descriptor)
        descriptor = -1
        guard closeResult == 0, link(temporary.path, destination.path) == 0
        else { throw ProtocolError.invalid }
    }
}
