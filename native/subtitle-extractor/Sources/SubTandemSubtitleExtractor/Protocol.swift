import Foundation
import Security

enum ProtocolLimits {
    static let maxRequestBytes = 65_536
    static let maxCueCount = 20_000
    static let maxOutputBytes = 16_777_216
    static let deadlineMilliseconds = 15_000
}

enum EmbeddedSubtitleCodec: String, Codable, Sendable {
    case subrip
    case ass
    case ssa
    case movText = "mov_text"
}

struct StreamIdentity: Sendable, Equatable {
    let ffIndex: Int
    let sourceID: Int?
    let codec: EmbeddedSubtitleCodec
}

struct ExtractionRequest: Sendable {
    let mediaURL: URL
    let stream: StreamIdentity
    let maxCueCount: Int
    let maxOutputBytes: Int
}

struct PrepareRequest: Sendable {
    let jobID: UUID
    let mediaPath: String
    let stream: StreamIdentity
    let deadlineMilliseconds: Int
    let maxCueCount: Int
    let maxOutputBytes: Int
}

struct ExtractionMetadata: Sendable, Equatable {
    let cueCount: Int
    let byteCount: Int
    let sha256: String
}

struct ExtractedResult: Sendable, Equatable {
    let jobID: UUID
    let resultID: UUID
    let metadata: ExtractionMetadata
}

enum ExtractorError: String, Error, Equatable, Sendable {
    case invalidRequest = "INVALID_REQUEST"
    case unsupportedCodec = "UNSUPPORTED_CODEC"
    case trackIdentityMismatch = "TRACK_IDENTITY_MISMATCH"
    case emptyOrUnreadable = "EMPTY_OR_UNREADABLE"
    case outputLimit = "OUTPUT_LIMIT"
    case timedOut = "TIMED_OUT"
    case cancelled = "CANCELLED"
    case extractionFailed = "EXTRACTION_FAILED"
}

struct ReadyFrame: Encodable, Sendable {
    let type = "ready"
    let port: UInt16
    let token: String
    let protocolVersion = 1

    func encodedLine() throws -> String {
        var data = try JSONEncoder().encode(self)
        data.append(0x0A)
        return String(decoding: data, as: UTF8.self)
    }
}

enum SecureRandom {
    static func token() throws -> String {
        var data = Data(count: 32)
        let status = data.withUnsafeMutableBytes { buffer in
            SecRandomCopyBytes(kSecRandomDefault, buffer.count, buffer.baseAddress!)
        }
        guard status == errSecSuccess else { throw ExtractorError.extractionFailed }
        return data.base64EncodedString()
            .replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "=", with: "")
    }
}

struct ProtocolResponse: Sendable {
    let statusCode: Int
    let body: Data

    static func json(statusCode: Int, _ object: Any) -> ProtocolResponse {
        let data = (try? JSONSerialization.data(withJSONObject: object, options: [.sortedKeys])) ?? Data("{}".utf8)
        return ProtocolResponse(statusCode: statusCode, body: data)
    }

    static func error(_ error: ExtractorError, statusCode: Int = 400) -> ProtocolResponse {
        .json(statusCode: statusCode, ["error": error.rawValue])
    }
}

enum ProtocolDecoder {
    static func prepare(_ data: Data) throws -> PrepareRequest {
        let json = try object(data, keys: ["deadlineMs", "jobId", "maxCueCount", "maxOutputBytes", "mediaPath", "stream"])
        guard let jobText = json["jobId"] as? String,
              let jobID = UUID(uuidString: jobText),
              let mediaPath = json["mediaPath"] as? String,
              mediaPath.hasPrefix("/"),
              !mediaPath.contains("\0"),
              let deadline = json["deadlineMs"] as? Int,
              deadline == ProtocolLimits.deadlineMilliseconds,
              let maxCueCount = json["maxCueCount"] as? Int,
              maxCueCount == ProtocolLimits.maxCueCount,
              let maxOutputBytes = json["maxOutputBytes"] as? Int,
              maxOutputBytes == ProtocolLimits.maxOutputBytes,
              let streamJSON = json["stream"] as? [String: Any],
              Set(streamJSON.keys) == Set(["codec", "ffIndex", "sourceId"]),
              let codecText = streamJSON["codec"] as? String,
              let codec = EmbeddedSubtitleCodec(rawValue: codecText),
              let ffIndex = streamJSON["ffIndex"] as? Int,
              ffIndex >= 0
        else { throw ExtractorError.invalidRequest }
        let sourceID: Int?
        if streamJSON["sourceId"] is NSNull {
            sourceID = nil
        } else if let value = streamJSON["sourceId"] as? Int {
            sourceID = value
        } else {
            throw ExtractorError.invalidRequest
        }
        return PrepareRequest(
            jobID: jobID,
            mediaPath: mediaPath,
            stream: StreamIdentity(ffIndex: ffIndex, sourceID: sourceID, codec: codec),
            deadlineMilliseconds: deadline,
            maxCueCount: maxCueCount,
            maxOutputBytes: maxOutputBytes
        )
    }

    static func identifier(_ data: Data, key: String) throws -> UUID {
        let json = try object(data, keys: [key])
        guard let value = json[key] as? String, let identifier = UUID(uuidString: value)
        else { throw ExtractorError.invalidRequest }
        return identifier
    }

    static func empty(_ data: Data) throws {
        if data.isEmpty { return }
        _ = try object(data, keys: [])
    }

    private static func object(_ data: Data, keys: Set<String>) throws -> [String: Any] {
        guard data.count <= ProtocolLimits.maxRequestBytes,
              let json = try JSONSerialization.jsonObject(with: data) as? [String: Any],
              Set(json.keys) == keys
        else { throw ExtractorError.invalidRequest }
        return json
    }
}
