import Darwin
import Foundation

enum SubTandemSubtitleExtractorMain {
    static func run() async throws {
        let arguments = CommandLine.arguments
        guard let tempIndex = arguments.firstIndex(of: "--temp-directory"),
              arguments.indices.contains(tempIndex + 1)
        else { throw ExtractorError.invalidRequest }
        let parentPID: Int32
        if let parentIndex = arguments.firstIndex(of: "--parent-pid"),
           arguments.indices.contains(parentIndex + 1),
           let parsed = Int32(arguments[parentIndex + 1]) {
            parentPID = parsed
        } else {
            parentPID = getppid()
        }
        let rootURL = URL(fileURLWithPath: arguments[tempIndex + 1], isDirectory: true)
        let jobs = try ExtractionJobs(rootURL: rootURL)
        let token = try SecureRandom.token()
        let liveness = LivenessState(parentPID: parentPID)
        let server = try SubtitleExtractorServer(token: token, jobs: jobs, liveness: liveness)
        let port = try await server.start()
        FileHandle.standardOutput.write(Data(try ReadyFrame(port: port, token: token).encodedLine().utf8))
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
