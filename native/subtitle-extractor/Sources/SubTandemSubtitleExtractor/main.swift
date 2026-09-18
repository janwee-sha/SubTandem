import Darwin
import Foundation

enum SubTandemSubtitleExtractorMain {
    static func run() async throws {
        let arguments = CommandLine.arguments
        if arguments.contains("--rpc-client") {
            try await FileRPCClient.run(arguments: arguments)
            return
        }
        guard let tempIndex = arguments.firstIndex(of: "--temp-directory"),
              arguments.indices.contains(tempIndex + 1),
              let readyIndex = arguments.firstIndex(of: "--ready-file"),
              arguments.indices.contains(readyIndex + 1)
        else { throw ExtractorError.invalidRequest }
        let parentPID: Int32
        if let parentIndex = arguments.firstIndex(of: "--parent-pid"),
           arguments.indices.contains(parentIndex + 1),
           let parsed = Int32(arguments[parentIndex + 1]) {
            parentPID = parsed
        } else {
            parentPID = getppid()
        }
        let rootURL = URL(
            fileURLWithPath: arguments[tempIndex + 1],
            isDirectory: true
        ).standardizedFileURL
        let readyFile = URL(fileURLWithPath: arguments[readyIndex + 1]).standardizedFileURL
        guard readyFile.deletingLastPathComponent().path == rootURL
            .appendingPathComponent(".ready", isDirectory: true).path,
              readyFile.lastPathComponent.hasPrefix("extractor-"),
              readyFile.pathExtension == "json"
        else { throw ExtractorError.invalidRequest }
        let jobs = try ExtractionJobs(rootURL: rootURL)
        try FileRPCClient.prepareDirectory(
            rootURL.appendingPathComponent(".rpc", isDirectory: true)
        )
        let token = try SecureRandom.token()
        let liveness = LivenessState(parentPID: parentPID)
        let server = try SubtitleExtractorServer(token: token, jobs: jobs, liveness: liveness)
        let port = try await server.start()
        try ReadyFileWriter.write(ReadyFrame(port: port, token: token), to: readyFile)
        while !liveness.shouldExit(activeJobs: jobs.activeCount()) {
            try await Task.sleep(nanoseconds: 1_000_000_000)
        }
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
