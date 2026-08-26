import Foundation

struct SubtitleExtractorTestFailure: Error {
    let description: String
}

func check(_ condition: @autoclosure () -> Bool, _ description: String) throws {
    if !condition() { throw SubtitleExtractorTestFailure(description: description) }
}
