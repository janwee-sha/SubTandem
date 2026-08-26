import Foundation

final class ExtractionJobs: @unchecked Sendable {
    private let rootURL: URL
    private let extractor: any ExtractionEngine
    private let lock = NSLock()
    private var active: (id: UUID, task: Task<ExtractedResult, Error>)?
    private var completed = Set<UUID>()
    private var closed = false

    init(rootURL: URL, extractor: any ExtractionEngine = SubtitleExtractor()) throws {
        guard rootURL.isFileURL, rootURL.path.hasPrefix("/") else {
            throw ExtractorError.invalidRequest
        }
        self.rootURL = rootURL
        self.extractor = extractor
        try FileManager.default.createDirectory(
            at: rootURL,
            withIntermediateDirectories: true,
            attributes: [.posixPermissions: 0o700]
        )
        try FileManager.default.setAttributes(
            [.posixPermissions: 0o700],
            ofItemAtPath: rootURL.path
        )
        try cleanupStaleResults()
    }

    func prepare(_ request: PrepareRequest) async throws -> ExtractedResult {
        let outputDirectory = resultDirectory(request.jobID)
        let outputURL = outputDirectory.appendingPathComponent("output.srt")
        try lock.withLock {
            guard !closed,
                  active == nil,
                  !completed.contains(request.jobID),
                  !FileManager.default.fileExists(atPath: outputDirectory.path)
            else { throw ExtractorError.invalidRequest }
        }
        do {
            try FileManager.default.createDirectory(
                at: outputDirectory,
                withIntermediateDirectories: false,
                attributes: [.posixPermissions: 0o700]
            )
            try FileManager.default.setAttributes(
                [.posixPermissions: 0o700],
                ofItemAtPath: outputDirectory.path
            )
        } catch {
            throw ExtractorError.extractionFailed
        }
        let extractor = self.extractor
        let task = Task.detached(priority: .userInitiated) {
            let metadata = try extractor.extract(
                request: ExtractionRequest(
                    mediaURL: URL(fileURLWithPath: request.mediaPath),
                    stream: request.stream,
                    maxCueCount: request.maxCueCount,
                    maxOutputBytes: request.maxOutputBytes
                ),
                outputURL: outputURL,
                isCancelled: { Task.isCancelled }
            )
            return ExtractedResult(jobID: request.jobID, resultID: request.jobID, metadata: metadata)
        }
        do {
            try lock.withLock {
                guard !closed, active == nil else { throw ExtractorError.cancelled }
                active = (request.jobID, task)
            }
        } catch {
            task.cancel()
            try? FileManager.default.removeItem(at: outputDirectory)
            throw error
        }
        do {
            let result = try await task.value
            lock.withLock {
                if active?.id == request.jobID { active = nil }
                completed.insert(request.jobID)
            }
            return result
        } catch {
            lock.withLock {
                if active?.id == request.jobID { active = nil }
            }
            try? FileManager.default.removeItem(at: outputDirectory)
            if error is CancellationError { throw ExtractorError.cancelled }
            throw error
        }
    }

    func cancel(_ jobID: UUID) async -> String {
        let task = lock.withLock { () -> Task<ExtractedResult, Error>? in
            guard active?.id == jobID else { return nil }
            return active?.task
        }
        if let task {
            task.cancel()
            _ = await task.result
            lock.withLock {
                if active?.id == jobID { active = nil }
            }
            try? FileManager.default.removeItem(at: resultDirectory(jobID))
            return "cancelled"
        }
        return lock.withLock { completed.contains(jobID) ? "already-completed" : "unknown" }
    }

    func release(_ resultID: UUID) throws {
        let directory = resultDirectory(resultID)
        if FileManager.default.fileExists(atPath: directory.path) {
            try FileManager.default.removeItem(at: directory)
        }
        _ = lock.withLock { completed.remove(resultID) }
    }

    func shutdown() async {
        let task = lock.withLock { () -> Task<ExtractedResult, Error>? in
            closed = true
            return active?.task
        }
        task?.cancel()
        if let task { _ = await task.result }
        lock.withLock { active = nil }
        try? cleanupStaleResults()
    }

    func activeCount() -> Int {
        lock.withLock { active == nil ? 0 : 1 }
    }

    private func resultDirectory(_ identifier: UUID) -> URL {
        rootURL.appendingPathComponent(identifier.uuidString.lowercased(), isDirectory: true)
    }

    private func cleanupStaleResults() throws {
        let entries = try FileManager.default.contentsOfDirectory(
            at: rootURL,
            includingPropertiesForKeys: nil,
            options: [.skipsHiddenFiles]
        )
        for entry in entries where UUID(uuidString: entry.lastPathComponent) != nil {
            try FileManager.default.removeItem(at: entry)
        }
    }
}
