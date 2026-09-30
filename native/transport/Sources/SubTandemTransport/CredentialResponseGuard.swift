import Foundation

enum CredentialResponseGuard {
    static let maximumHeaderBytes = 65_536
    private static let maximumInspectionBytes = 16 * 1_048_576
    private static let maximumDepth = 16
    private static let maximumNodes = 65_536
    private static let escapes = try! NSRegularExpression(pattern: #"(?:\\(?:u[0-9a-fA-F]{4}|["\\/bfnrt]))+"#)

    static func validate(body: Data, headers: [String], credential: Data) throws {
        guard !credential.isEmpty else { return }
        guard let key = String(data: credential, encoding: .utf8),
              headers.reduce(0, { $0 + $1.utf8.count }) <= maximumHeaderBytes
        else { throw CredentialFailure.reflection }
        var budget = maximumInspectionBytes
        var nodes = maximumNodes
        func inspect(_ text: String, depth: Int) throws {
            budget -= text.utf8.count
            nodes -= 1
            guard budget >= 0, nodes >= 0, depth <= maximumDepth, !text.contains(key) else { throw CredentialFailure.reflection }
            let range = NSRange(text.startIndex..<text.endIndex, in: text)
            let matches = escapes.matches(in: text, range: range)
            if !matches.isEmpty {
                let decoded = NSMutableString(string: text)
                for match in matches.reversed() {
                    guard let tokenRange = Range(match.range, in: text) else { throw CredentialFailure.reflection }
                    let token = String(text[tokenRange])
                    if let value = try? JSONSerialization.jsonObject(with: Data(("\"" + token + "\"").utf8), options: [.fragmentsAllowed]) as? String {
                        decoded.replaceCharacters(in: match.range, with: value)
                    }
                }
                if decoded as String != text { try inspect(decoded as String, depth: depth + 1) }
            }
            let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
            if let first = trimmed.first, ["{", "[", "\""].contains(first),
               let object = try? JSONSerialization.jsonObject(with: Data(trimmed.utf8), options: [.fragmentsAllowed]) {
                try walk(object, depth: depth + 1)
            }
        }
        func walk(_ value: Any, depth: Int) throws {
            nodes -= 1
            guard nodes >= 0, depth <= maximumDepth else { throw CredentialFailure.reflection }
            if let text = value as? String { try inspect(text, depth: depth) }
            else if let object = value as? [String: Any] {
                for (name, child) in object { try inspect(name, depth: depth); try walk(child, depth: depth + 1) }
            } else if let array = value as? [Any] {
                for child in array { try walk(child, depth: depth + 1) }
            }
        }
        guard let text = String(data: body, encoding: .utf8) else { throw CredentialFailure.reflection }
        try inspect(text, depth: 0)
        for header in headers { try inspect(header, depth: 0) }
    }
}
