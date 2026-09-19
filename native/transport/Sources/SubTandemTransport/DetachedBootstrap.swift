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
