import Darwin
import Foundation

enum SubTandemSubtitleExtractorMain {
    static func run() async throws {
        let arguments = CommandLine.arguments
        if arguments.count == 6,
           arguments[1] == "launch",
           arguments[2] == "--temp-directory",
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
              arguments[2] == "--temp-directory",
              arguments[4] == "--ready-file",
              arguments[6] == "--parent-pid",
              let parentPID = Int32(arguments[7]),
              parentPID > 1
        else { throw ExtractorError.invalidRequest }
        let rootURL = URL(
            fileURLWithPath: arguments[3],
            isDirectory: true
        ).standardizedFileURL
        let readyFile = URL(fileURLWithPath: arguments[5]).standardizedFileURL
        guard readyFile.deletingLastPathComponent().path == rootURL
            .appendingPathComponent(".ready", isDirectory: true).path,
              readyFile.lastPathComponent.hasPrefix("extractor-"),
              readyFile.pathExtension == "json"
        else { throw ExtractorError.invalidRequest }
        let jobs = try ExtractionJobs(rootURL: rootURL)
        let rpcDirectory = rootURL.appendingPathComponent(".rpc", isDirectory: true)
        try FileRPCWorker.prepareDirectory(rpcDirectory)
        let token = try SecureRandom.token()
        let liveness = LivenessState(parentPID: parentPID)
        let server = try SubtitleExtractorServer(token: token, jobs: jobs, liveness: liveness)
        let port = try await server.start()
        let worker = Task {
            await FileRPCWorker.run(directory: rpcDirectory, port: port) { path, token, body in
                await server.handleFileRequest(path: path, token: token, body: body)
            }
        }
        try ReadyFileWriter.write(ReadyFrame(port: port, token: token), to: readyFile)
        while !liveness.shouldExit(activeJobs: jobs.activeCount()) {
            try await Task.sleep(nanoseconds: 1_000_000_000)
        }
        worker.cancel()
        await worker.value
        await jobs.shutdown()
        server.stop()
    }
}

Task {
    do {
        try await SubTandemSubtitleExtractorMain.run()
        exit(EXIT_SUCCESS)
    } catch {
        exit(EXIT_FAILURE)
    }
}
dispatchMain()
