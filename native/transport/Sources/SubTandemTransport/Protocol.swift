import Foundation

enum ProtocolLimits {
    static let maxRequestBytes = 2 * 1_024 * 1_024
    static let maxResponseBytes = 4 * 1_024 * 1_024
    static let minTimeoutMilliseconds = 100
    static let maxTimeoutMilliseconds = 120_000
}

struct ReadyFrame: Encodable, Sendable {
    let type: String
    let port: UInt16
    let token: String
    let protocolVersion: Int

    init(port: UInt16, token: String) {
        self.type = "ready"
        self.port = port
        self.token = token
        self.protocolVersion = 1
    }

    func encodedLine() throws -> String {
        var data = try JSONEncoder().encode(self)
        data.append(0x0A)
        return String(decoding: data, as: UTF8.self)
    }
}

enum SecureRandom {
    static func bytes(count: Int) throws -> Data {
        guard (1...4_096).contains(count) else { throw TransportProtocolError.invalidRequest }
        var data = Data(count: count)
        let status = data.withUnsafeMutableBytes { buffer in
            SecRandomCopyBytes(kSecRandomDefault, count, buffer.baseAddress!)
        }
        guard status == errSecSuccess else { throw TransportProtocolError.entropyUnavailable }
        return data
    }

    static func token() throws -> String {
        try bytes(count: 32).base64EncodedString()
            .replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "=", with: "")
    }
}

enum TransportProtocolError: Error, Equatable {
    case invalidRequest
    case entropyUnavailable
    case credentialStoreUnavailable
    case forbiddenDestination
    case duplicateJob
    case responseTooLarge
    case timedOut
    case upstreamNetwork
}

enum CancelState: String, Codable, Sendable {
    case cancelled
    case alreadyCompleted = "already-completed"
    case unknown
}

struct TransportRequest: Sendable {
    let jobID: String
    let method: String
    let url: String
    let headers: [String: String]
    let proxyMode: String
    let body: Data
    let timeoutMilliseconds: Int
    let maxResponseBytes: Int

    func validated() throws -> TransportRequest {
        guard UUID(uuidString: jobID) != nil,
              ["GET", "POST"].contains(method),
              let parsedURL = URL(string: url),
              ["system", "direct"].contains(proxyMode),
              body.count <= ProtocolLimits.maxRequestBytes,
              (ProtocolLimits.minTimeoutMilliseconds...ProtocolLimits.maxTimeoutMilliseconds).contains(timeoutMilliseconds),
              (1...ProtocolLimits.maxResponseBytes).contains(maxResponseBytes),
              headers.count <= 32,
              headers.allSatisfy({ $0.key.count <= 128 && $0.value.count <= 8_192 })
        else { throw TransportProtocolError.invalidRequest }
        try UpstreamPolicy.validate(parsedURL)
        return self
    }
}

struct TransportResponse: Sendable {
    let jobID: String
    let transportState: String
    let statusCode: Int
    let headers: [String: String]
    let body: Data
}

struct ProtocolResponse: Sendable {
    let statusCode: Int
    let body: Data

    static func json(statusCode: Int, _ object: Any) -> ProtocolResponse {
        let data = (try? JSONSerialization.data(withJSONObject: object, options: [.sortedKeys])) ?? Data("{}".utf8)
        return ProtocolResponse(statusCode: statusCode, body: data)
    }
}

final class LivenessState: @unchecked Sendable {
    private let parentPID: Int32?
    private let idleTimeout: TimeInterval
    private let lock = NSLock()
    private var lastActivity = Date()
    private var shuttingDown = false

    init(parentPID: Int32?, idleTimeout: TimeInterval = 300) {
        self.parentPID = parentPID
        self.idleTimeout = idleTimeout
    }

    func touch(now: Date = Date()) {
        lock.withLock { lastActivity = now }
    }

    func requestShutdown() {
        lock.withLock { shuttingDown = true }
    }

    func shouldExit(parentIsAlive: Bool, activeJobs: Int = 0, now: Date = Date()) -> Bool {
        lock.withLock {
            shuttingDown || !parentIsAlive || (activeJobs == 0 && now.timeIntervalSince(lastActivity) >= idleTimeout)
        }
    }

    func actualParentIsAlive() -> Bool {
        guard let parentPID else { return true }
        return kill(parentPID, 0) == 0 || errno == EPERM
    }
}

actor ProtocolHandler {
    private let token: String
    private let httpClient: HTTPClient
    private let credentialStore: CredentialStoreAccess
    private let shutdown: @Sendable () -> Void

    init(
        token: String,
        httpClient: HTTPClient = HTTPClient(),
        credentialStore: CredentialStoreAccess,
        shutdown: @escaping @Sendable () -> Void = {}
    ) {
        self.token = token
        self.httpClient = httpClient
        self.credentialStore = credentialStore
        self.shutdown = shutdown
    }

    func handle(path: String, authorization: String?, body: Data) async -> ProtocolResponse {
        guard authorization == "Bearer \(token)" else { return .json(statusCode: 401, ["error": "unauthorized"]) }
        guard body.count <= ProtocolLimits.maxRequestBytes else { return .json(statusCode: 413, ["error": "request-too-large"]) }

        switch path {
        case "/v1/health":
            // IINA 1.4.4 serializes `data: {}` as a zero-byte POST body. Both
            // encodings are side-effect-free and carry no caller-controlled
            // fields, so accept either while rejecting every other payload.
            guard body.isEmpty || body == Data("{}".utf8) else {
                return .json(statusCode: 400, ["error": "invalid-request"])
            }
            return .json(statusCode: 200, ["state": "ok"])

        case "/v1/credentials":
            guard let json = try? JSONSerialization.jsonObject(with: body) as? [String: Any],
                  let action = json["action"] as? String,
                  let profileID = json["profileId"] as? String
            else { return .json(statusCode: 400, ["error": "invalid-credential-request"]) }
            do {
                switch action {
                case "read" where json.count == 2:
                    let fields = try await credentialStore.read(profileID: profileID)
                    let responseFields: Any = fields.map { $0 as Any } ?? NSNull()
                    return .json(statusCode: 200, ["fields": responseFields])
                case "write" where json.count == 3:
                    guard let fields = json["fields"] as? [String: String] else {
                        return .json(statusCode: 400, ["error": "invalid-credential-request"])
                    }
                    try await credentialStore.write(profileID: profileID, fields: fields)
                    return .json(statusCode: 200, ["state": "saved"])
                case "delete" where json.count == 2:
                    try await credentialStore.delete(profileID: profileID)
                    return .json(statusCode: 200, ["state": "deleted"])
                default:
                    return .json(statusCode: 400, ["error": "invalid-credential-request"])
                }
            } catch TransportProtocolError.invalidRequest {
                return .json(statusCode: 400, ["error": "invalid-credential-request"])
            } catch {
                return .json(statusCode: 503, ["error": "credential-store-unavailable"])
            }

        case "/v1/cancel":
            guard let json = try? JSONSerialization.jsonObject(with: body) as? [String: Any],
                  let jobID = json["jobId"] as? String
            else { return .json(statusCode: 400, ["error": "invalid-cancel-request"]) }
            let state = await httpClient.cancel(jobID: jobID)
            return .json(statusCode: 200, ["state": state.rawValue])

        case "/v1/shutdown":
            httpClient.close()
            shutdown()
            return .json(statusCode: 200, ["state": "shutting-down"])

        case "/v1/request":
            do {
                let request = try Self.decodeRequest(body).validated()
                let result = try await httpClient.perform(request)
                let responseBody: [String: Any] = [
                    "jobId": result.jobID,
                    "transportState": result.transportState,
                    "statusCode": result.statusCode,
                    "headers": result.headers,
                    "bodyText": String(decoding: result.body, as: UTF8.self),
                ]
                return .json(statusCode: 200, responseBody)
            } catch {
                return Self.errorResponse(for: error)
            }

        default:
            return .json(statusCode: 404, ["error": "not-found"])
        }
    }

    nonisolated static func errorResponse(for error: Error) -> ProtocolResponse {
        switch error {
        case TransportProtocolError.duplicateJob:
            return .json(statusCode: 409, ["error": "duplicate-job"])
        case TransportProtocolError.forbiddenDestination:
            return .json(statusCode: 403, ["error": "forbidden-destination"])
        case TransportProtocolError.timedOut:
            return .json(statusCode: 504, ["error": "upstream-timeout"])
        case TransportProtocolError.upstreamNetwork:
            return .json(statusCode: 502, ["error": "upstream-network"])
        case TransportProtocolError.responseTooLarge:
            return .json(statusCode: 413, ["error": "response-too-large"])
        case TransportProtocolError.invalidRequest:
            return .json(statusCode: 400, ["error": "invalid-request"])
        case is CancellationError:
            return .json(statusCode: 409, ["error": "request-cancelled"])
        default:
            return .json(statusCode: 400, ["error": "request-failed"])
        }
    }

    private static func decodeRequest(_ body: Data) throws -> TransportRequest {
        guard let json = try JSONSerialization.jsonObject(with: body) as? [String: Any],
              let jobID = json["jobId"] as? String,
              let method = json["method"] as? String,
              let url = json["url"] as? String,
              let headers = json["headers"] as? [String: String],
              let timeout = json["timeoutMs"] as? Int,
              let maxResponse = json["maxResponseBytes"] as? Int
        else { throw TransportProtocolError.invalidRequest }
        let proxyMode = json["proxyMode"] as? String ?? "system"
        let requestBody: Data
        if let object = json["body"] {
            requestBody = try JSONSerialization.data(withJSONObject: object, options: [])
        } else {
            requestBody = Data()
        }
        return TransportRequest(jobID: jobID, method: method, url: url, headers: headers, proxyMode: proxyMode, body: requestBody, timeoutMilliseconds: timeout, maxResponseBytes: maxResponse)
    }
}
