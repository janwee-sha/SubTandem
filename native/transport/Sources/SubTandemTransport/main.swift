import Darwin
import Foundation

enum SubTandemTransportMain {
    static func run() async throws {
        // A GUI plugin should follow macOS proxy settings, not proxy variables
        // accidentally inherited from the shell or launcher that started IINA.
        // Re-exec before CFNetwork initializes; unsetting variables after launch
        // is too late because macOS 26 caches them at process startup.
        try relaunchWithoutInheritedProxyIfNeeded()
        let arguments = CommandLine.arguments
        let parentPID: Int32
        if let index = arguments.firstIndex(of: "--parent-pid"), arguments.indices.contains(index + 1) {
            parentPID = Int32(arguments[index + 1]) ?? getppid()
        } else {
            parentPID = getppid()
        }
        let token = try SecureRandom.token()
        let liveness = LivenessState(parentPID: parentPID)
        guard let dataIndex = arguments.firstIndex(of: "--data-directory"),
              arguments.indices.contains(dataIndex + 1)
        else { throw TransportProtocolError.invalidRequest }
        let credentialStore = try SecureCredentialStore(
            directory: URL(fileURLWithPath: arguments[dataIndex + 1], isDirectory: true)
        )
        let server = try TransportServer(
            token: token,
            liveness: liveness,
            credentialStore: credentialStore
        )
        let port = try await server.start()
        FileHandle.standardOutput.write(Data(try ReadyFrame(port: port, token: token).encodedLine().utf8))

        while !liveness.shouldExit(parentIsAlive: liveness.actualParentIsAlive()) {
            try await Task.sleep(nanoseconds: 1_000_000_000)
        }
        server.stop()
    }

    private static func relaunchWithoutInheritedProxyIfNeeded() throws {
        let environment = ProcessInfo.processInfo.environment
        let sanitized = ProxyEnvironment.sanitized(environment)
        guard sanitized.count != environment.count else { return }

        let arguments = CommandLine.arguments
        let environmentEntries = sanitized.map { "\($0.key)=\($0.value)" }
        let argumentPointers = arguments.map { strdup($0) } + [nil]
        let environmentPointers = environmentEntries.map { strdup($0) } + [nil]
        defer {
            argumentPointers.compactMap { $0 }.forEach { free($0) }
            environmentPointers.compactMap { $0 }.forEach { free($0) }
        }
        try CommandLine.arguments[0].withCString { executable in
            let status = argumentPointers.withUnsafeBufferPointer { argumentsBuffer in
                environmentPointers.withUnsafeBufferPointer { environmentBuffer in
                    execve(
                        executable,
                        UnsafeMutablePointer(mutating: argumentsBuffer.baseAddress),
                        UnsafeMutablePointer(mutating: environmentBuffer.baseAddress)
                    )
                }
            }
            if status == -1 { throw TransportProtocolError.invalidRequest }
        }
    }

}

Task {
    do {
        try await SubTandemTransportMain.run()
        exit(EXIT_SUCCESS)
    } catch {
        exit(EXIT_FAILURE)
    }
}
dispatchMain()
