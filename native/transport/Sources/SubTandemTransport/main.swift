import Darwin
import Foundation

enum SubTandemTransportMain {
    static func run() async throws {
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
              arguments.indices.contains(dataIndex + 1),
              let readyIndex = arguments.firstIndex(of: "--ready-file"),
              arguments.indices.contains(readyIndex + 1)
        else { throw TransportProtocolError.invalidRequest }
        let dataDirectory = URL(
            fileURLWithPath: arguments[dataIndex + 1],
            isDirectory: true
        ).standardizedFileURL
        let readyFile = URL(fileURLWithPath: arguments[readyIndex + 1]).standardizedFileURL
        guard readyFile.deletingLastPathComponent().path == dataDirectory
            .appendingPathComponent(".ready", isDirectory: true).path,
              readyFile.lastPathComponent.hasPrefix("transport-"),
              readyFile.pathExtension == "json"
        else { throw TransportProtocolError.invalidRequest }
        let credentialStore = try SecureCredentialStore(
            directory: dataDirectory
        )
        let server = try TransportServer(
            token: token,
            liveness: liveness,
            credentialStore: credentialStore
        )
        let port = try await server.start()
        try ReadyFileWriter.write(ReadyFrame(port: port, token: token), to: readyFile)

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
