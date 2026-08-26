import Foundation

@main
struct SubtitleExtractorTestMain {
    static func main() async throws {
        try runExtractionTests()
        try await runLifecycleTests()
        try await runSecurityTests()
    }
}
