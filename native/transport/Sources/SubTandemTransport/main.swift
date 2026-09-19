import Darwin
import Foundation

enum SubTandemTransportMain {
    static func run() async throws {
        let arguments = CommandLine.arguments
        if arguments.count == 6,
           arguments[1] == "launch",
           arguments[2] == "--data-directory",
           arguments[4] == "--ready-file" {
            let readyFile = URL(fileURLWithPath: arguments[5]).standardizedFileURL
            try DetachedBootstrap.launch(
                arguments: Array(arguments[2...5]),
                readyFile: readyFile
            )
            return
        }
        guard arguments.count == 8,
              arguments[1] == "serve",
              arguments[2] == "--data-directory",
              arguments[4] == "--ready-file",
              arguments[6] == "--parent-pid",
              let parentPID = Int32(arguments[7]),
              parentPID > 1
        else { throw TransportProtocolError.invalidRequest }
        try relaunchWithoutInheritedProxyIfNeeded()
        let token = try SecureRandom.token()
        let liveness = LivenessState(parentPID: parentPID)
        let dataDirectory = URL(
            fileURLWithPath: arguments[3],
            isDirectory: true
        ).standardizedFileURL
        let readyFile = URL(fileURLWithPath: arguments[5]).standardizedFileURL
        guard readyFile.deletingLastPathComponent().path == dataDirectory
            .appendingPathComponent(".ready", isDirectory: true).path,
              readyFile.lastPathComponent.hasPrefix("transport-"),
              readyFile.pathExtension == "json"
        else { throw TransportProtocolError.invalidRequest }
        let credentialStore = try SecureCredentialStore(
            directory: dataDirectory
        )
        let rpcDirectory = dataDirectory.appendingPathComponent(".rpc", isDirectory: true)
        try FileRPCWorker.prepareDirectory(rpcDirectory)
        let server = try TransportServer(
            token: token,
            liveness: liveness,
            credentialStore: credentialStore
        )
        let port = try await server.start()
        let worker = Task {
            await FileRPCWorker.run(directory: rpcDirectory, port: port) { path, token, body in
                await server.handleFileRequest(path: path, token: token, body: body)
            }
        }
        try ReadyFileWriter.write(ReadyFrame(port: port, token: token), to: readyFile)

        while !liveness.shouldExit(parentIsAlive: liveness.actualParentIsAlive()) {
            try await Task.sleep(nanoseconds: 1_000_000_000)
        }
        worker.cancel()
        await worker.value
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
