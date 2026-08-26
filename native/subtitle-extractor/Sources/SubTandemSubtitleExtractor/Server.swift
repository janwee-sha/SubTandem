import Foundation
import Network

enum HTTPRequestParseResult {
    case incomplete
    case invalid
    case complete(path: String, authorization: String?, body: Data)
}

final class LivenessState: @unchecked Sendable {
    private let parentPID: Int32
    private let idleTimeout: TimeInterval
    private let lock = NSLock()
    private var lastActivity = Date()
    private var shuttingDown = false

    init(parentPID: Int32, idleTimeout: TimeInterval = 300) {
        self.parentPID = parentPID
        self.idleTimeout = idleTimeout
    }

    func touch() {
        lock.withLock { lastActivity = Date() }
    }

    func requestShutdown() {
        lock.withLock { shuttingDown = true }
    }

    func shouldExit(activeJobs: Int) -> Bool {
        lock.withLock {
            shuttingDown ||
                !(kill(parentPID, 0) == 0 || errno == EPERM) ||
                (activeJobs == 0 && Date().timeIntervalSince(lastActivity) >= idleTimeout)
        }
    }
}

actor ProtocolHandler {
    private let token: String
    private let jobs: ExtractionJobs
    private let shutdownRequest: @Sendable () -> Void

    init(token: String, jobs: ExtractionJobs, shutdownRequest: @escaping @Sendable () -> Void) {
        self.token = token
        self.jobs = jobs
        self.shutdownRequest = shutdownRequest
    }

    func handle(path: String, authorization: String?, body: Data) async -> ProtocolResponse {
        guard authorization == "Bearer \(token)" else {
            return .error(.invalidRequest, statusCode: 401)
        }
        guard body.count <= ProtocolLimits.maxRequestBytes else {
            return .error(.invalidRequest, statusCode: 413)
        }
        do {
            switch path {
            case "/v1/health":
                try ProtocolDecoder.empty(body)
                return .json(statusCode: 200, ["state": "ok"])
            case "/v1/prepare":
                let request = try ProtocolDecoder.prepare(body)
                let result = try await jobs.prepare(request)
                return .json(statusCode: 200, [
                    "jobId": result.jobID.uuidString.lowercased(),
                    "state": "ready",
                    "resultId": result.resultID.uuidString.lowercased(),
                    "format": "srt",
                    "cueCount": result.metadata.cueCount,
                    "byteCount": result.metadata.byteCount,
                    "sha256": result.metadata.sha256,
                ])
            case "/v1/cancel":
                let jobID = try ProtocolDecoder.identifier(body, key: "jobId")
                return .json(statusCode: 200, ["state": await jobs.cancel(jobID)])
            case "/v1/release":
                let resultID = try ProtocolDecoder.identifier(body, key: "resultId")
                try jobs.release(resultID)
                return .json(statusCode: 200, ["state": "released"])
            case "/v1/shutdown":
                try ProtocolDecoder.empty(body)
                await jobs.shutdown()
                shutdownRequest()
                return .json(statusCode: 200, ["state": "shutting-down"])
            default:
                return .error(.invalidRequest, statusCode: 404)
            }
        } catch let error as ExtractorError {
            return .error(error, statusCode: statusCode(error))
        } catch {
            return .error(.extractionFailed)
        }
    }

    private func statusCode(_ error: ExtractorError) -> Int {
        switch error {
        case .timedOut:
            return 504
        case .outputLimit:
            return 413
        case .cancelled:
            return 409
        default:
            return 400
        }
    }
}

final class SubtitleExtractorServer: @unchecked Sendable {
    static let boundHost = "127.0.0.1"

    private let listener: NWListener
    private let queue = DispatchQueue(label: "io.subtandem.subtitle-extractor.server")
    private let handler: ProtocolHandler
    private let liveness: LivenessState
    private var readyContinuation: CheckedContinuation<UInt16, Error>?

    init(token: String, jobs: ExtractionJobs, liveness: LivenessState) throws {
        self.liveness = liveness
        let parameters = NWParameters.tcp
        parameters.requiredLocalEndpoint = .hostPort(
            host: NWEndpoint.Host(Self.boundHost),
            port: .any
        )
        parameters.allowLocalEndpointReuse = false
        listener = try NWListener(using: parameters)
        handler = ProtocolHandler(
            token: token,
            jobs: jobs,
            shutdownRequest: { liveness.requestShutdown() }
        )
    }

    func start() async throws -> UInt16 {
        try await withCheckedThrowingContinuation { continuation in
            readyContinuation = continuation
            listener.stateUpdateHandler = { [weak self] state in
                guard let self else { return }
                switch state {
                case .ready:
                    guard let port = listener.port?.rawValue else {
                        readyContinuation?.resume(throwing: ExtractorError.extractionFailed)
                        readyContinuation = nil
                        return
                    }
                    readyContinuation?.resume(returning: port)
                    readyContinuation = nil
                case .failed(let error):
                    readyContinuation?.resume(throwing: error)
                    readyContinuation = nil
                default:
                    break
                }
            }
            listener.newConnectionHandler = { [weak self] connection in
                self?.accept(connection)
            }
            listener.start(queue: queue)
        }
    }

    func stop() {
        listener.cancel()
    }

    private func accept(_ connection: NWConnection) {
        guard case .hostPort(let host, _) = connection.endpoint,
              host.debugDescription.contains("127.0.0.1") ||
                host.debugDescription.contains("::ffff:127.0.0.1")
        else {
            connection.cancel()
            return
        }
        connection.start(queue: queue)
        receive(connection, accumulated: Data())
    }

    private func receive(_ connection: NWConnection, accumulated: Data) {
        let maximumBytes = ProtocolLimits.maxRequestBytes + 16_384
        guard accumulated.count < maximumBytes else {
            connection.cancel()
            return
        }
        connection.receive(
            minimumIncompleteLength: 1,
            maximumLength: maximumBytes - accumulated.count
        ) { [weak self] data, _, complete, error in
            guard let self, error == nil, let data else {
                connection.cancel()
                return
            }
            var frame = accumulated
            frame.append(data)
            switch Self.parseRequest(frame) {
            case .incomplete where !complete:
                receive(connection, accumulated: frame)
            case .complete(let path, let authorization, let body):
                liveness.touch()
                Task {
                    let response = await self.handler.handle(
                        path: path,
                        authorization: authorization,
                        body: body
                    )
                    connection.send(
                        content: Self.httpResponse(response),
                        completion: .contentProcessed { _ in connection.cancel() }
                    )
                }
            default:
                connection.cancel()
            }
        }
    }

    static func parseRequest(_ data: Data) -> HTTPRequestParseResult {
        let marker = Data("\r\n\r\n".utf8)
        guard let headerRange = data.range(of: marker) else {
            return data.count <= 16_384 ? .incomplete : .invalid
        }
        guard headerRange.lowerBound <= 16_384,
              let headerText = String(data: data[..<headerRange.lowerBound], encoding: .utf8)
        else { return .invalid }
        let lines = headerText.components(separatedBy: "\r\n")
        guard let first = lines.first else { return .invalid }
        let requestLine = first.split(separator: " ")
        guard requestLine.count == 3,
              requestLine[0] == "POST",
              requestLine[2] == "HTTP/1.1"
        else { return .invalid }
        var headers: [String: String] = [:]
        for line in lines.dropFirst() {
            guard let separator = line.firstIndex(of: ":") else { return .invalid }
            let name = line[..<separator].trimmingCharacters(in: .whitespaces).lowercased()
            let value = line[line.index(after: separator)...].trimmingCharacters(in: .whitespaces)
            if headers[name] != nil { return .invalid }
            headers[name] = value
        }
        guard headers["content-type"]?.lowercased().hasPrefix("application/json") == true,
              let lengthText = headers["content-length"],
              let length = Int(lengthText),
              (0...ProtocolLimits.maxRequestBytes).contains(length)
        else { return .invalid }
        let bodyStart = headerRange.upperBound
        let bodyBytes = data.distance(from: bodyStart, to: data.endIndex)
        if bodyBytes < length { return .incomplete }
        guard bodyBytes == length else { return .invalid }
        return .complete(
            path: String(requestLine[1]),
            authorization: headers["authorization"],
            body: Data(data[bodyStart...])
        )
    }

    private static func httpResponse(_ response: ProtocolResponse) -> Data {
        var output = Data(
            "HTTP/1.1 \(response.statusCode) OK\r\nContent-Type: application/json\r\nContent-Length: \(response.body.count)\r\nConnection: close\r\n\r\n".utf8
        )
        output.append(response.body)
        return output
    }
}
