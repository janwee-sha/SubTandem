import Foundation

final class BlockingExtractionEngine: ExtractionEngine, @unchecked Sendable {
    func extract(
        request: ExtractionRequest,
        outputURL: URL,
        isCancelled: @escaping @Sendable () -> Bool
    ) throws -> ExtractionMetadata {
        while !isCancelled() {
            Thread.sleep(forTimeInterval: 0.005)
        }
        throw ExtractorError.cancelled
    }
}

func runLifecycleTests() async throws {
    let root = FileManager.default.temporaryDirectory
        .appendingPathComponent("subtandem-lifecycle-\(UUID().uuidString)", isDirectory: true)
    let engine = BlockingExtractionEngine()
    let jobs = try ExtractionJobs(rootURL: root, extractor: engine)
    defer { try? FileManager.default.removeItem(at: root) }
    let firstID = UUID()
    let first = Task {
        try await jobs.prepare(
            PrepareRequest(
                jobID: firstID,
                mediaPath: fixtureURL("matroska-subrip.mkv").path,
                stream: StreamIdentity(ffIndex: 0, sourceID: nil, codec: .subrip),
                deadlineMilliseconds: 15_000,
                maxCueCount: 20_000,
                maxOutputBytes: 16_777_216
            )
        )
    }
    while jobs.activeCount() == 0 {
        try await Task.sleep(for: .milliseconds(5))
    }
    do {
        _ = try await jobs.prepare(
            PrepareRequest(
                jobID: UUID(),
                mediaPath: fixtureURL("matroska-subrip.mkv").path,
                stream: StreamIdentity(ffIndex: 0, sourceID: nil, codec: .subrip),
                deadlineMilliseconds: 15_000,
                maxCueCount: 20_000,
                maxOutputBytes: 16_777_216
            )
        )
        throw SubtitleExtractorTestFailure(description: "one process must allow one active job")
    } catch {
        try check(error as? ExtractorError == .invalidRequest, "second active job must be rejected")
    }
    let activeCancellation = await jobs.cancel(firstID)
    try check(activeCancellation == "cancelled", "active cancellation must be reported")
    _ = await first.result
    try check(jobs.activeCount() == 0, "cancel must clear active job")

    let otherRoot = FileManager.default.temporaryDirectory
        .appendingPathComponent("subtandem-lifecycle-\(UUID().uuidString)", isDirectory: true)
    let otherJobs = try ExtractionJobs(rootURL: otherRoot)
    defer { try? FileManager.default.removeItem(at: otherRoot) }
    let completedID = UUID()
    _ = try await otherJobs.prepare(
        PrepareRequest(
            jobID: completedID,
            mediaPath: fixtureURL("matroska-subrip.mkv").path,
            stream: StreamIdentity(ffIndex: 0, sourceID: nil, codec: .subrip),
            deadlineMilliseconds: 15_000,
            maxCueCount: 20_000,
            maxOutputBytes: 16_777_216
        )
    )
    let completedCancellation = await otherJobs.cancel(completedID)
    try check(completedCancellation == "already-completed", "completed job cancellation must be idempotent")
    try otherJobs.release(completedID)
    try otherJobs.release(completedID)
    try check(
        !FileManager.default.fileExists(
            atPath: otherRoot.appendingPathComponent(completedID.uuidString.lowercased()).path
        ),
        "release must remove only its exact UUID directory"
    )

    let staleRoot = FileManager.default.temporaryDirectory
        .appendingPathComponent("subtandem-stale-\(UUID().uuidString)", isDirectory: true)
    try FileManager.default.createDirectory(at: staleRoot, withIntermediateDirectories: true)
    let staleID = UUID().uuidString.lowercased()
    try FileManager.default.createDirectory(
        at: staleRoot.appendingPathComponent(staleID),
        withIntermediateDirectories: false
    )
    try FileManager.default.createDirectory(
        at: staleRoot.appendingPathComponent("keep"),
        withIntermediateDirectories: false
    )
    _ = try ExtractionJobs(rootURL: staleRoot)
    try check(!FileManager.default.fileExists(atPath: staleRoot.appendingPathComponent(staleID).path), "startup must remove UUID result directories")
    try check(FileManager.default.fileExists(atPath: staleRoot.appendingPathComponent("keep").path), "startup must preserve non-job directories")
    try? FileManager.default.removeItem(at: staleRoot)

    let missingParent = LivenessState(parentPID: 999_999, idleTimeout: 300)
    try check(missingParent.shouldExit(activeJobs: 0), "parent process loss must request exit")
}

private func fixtureURL(_ name: String) -> URL {
    URL(fileURLWithPath: #filePath)
        .deletingLastPathComponent()
        .deletingLastPathComponent()
        .deletingLastPathComponent()
        .deletingLastPathComponent()
        .deletingLastPathComponent()
        .appendingPathComponent("tests/fixtures/media/generated")
        .appendingPathComponent(name)
}
