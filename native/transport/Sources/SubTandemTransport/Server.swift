import Foundation
import Network

enum HTTPRequestParseResult {
    case incomplete
    case invalid
    case complete(path: String, authorization: String?, body: Data)
}

final class TransportServer: @unchecked Sendable {
    static let boundHost = "127.0.0.1"

    private let listener: NWListener
    private let queue = DispatchQueue(label: "io.subtandem.transport.server")
    private let handler: ProtocolHandler
    private let liveness: LivenessState
    private var readyContinuation: CheckedContinuation<UInt16, Error>?

    init(
        token: String,
        liveness: LivenessState,
        credentialStore: CredentialStoreAccess
    ) throws {
        self.liveness = liveness
        let parameters = NWParameters.tcp
        parameters.requiredLocalEndpoint = .hostPort(host: NWEndpoint.Host(Self.boundHost), port: .any)
        parameters.allowLocalEndpointReuse = false
        self.listener = try NWListener(using: parameters)
        self.handler = ProtocolHandler(
            token: token,
            credentialStore: credentialStore,
            shutdown: { liveness.requestShutdown() }
        )
    }

    func start() async throws -> UInt16 {
        try await withCheckedThrowingContinuation { continuation in
            readyContinuation = continuation
            listener.stateUpdateHandler = { [weak self] state in
                guard let self else { return }
                switch state {
                case .ready:
                    guard let port = self.listener.port?.rawValue else {
                        self.readyContinuation?.resume(throwing: TransportProtocolError.invalidRequest)
                        self.readyContinuation = nil
                        return
                    }
                    self.readyContinuation?.resume(returning: port)
                    self.readyContinuation = nil
                case .failed(let error):
                    self.readyContinuation?.resume(throwing: error)
                    self.readyContinuation = nil
                default: break
                }
            }
            listener.newConnectionHandler = { [weak self] connection in self?.accept(connection) }
            listener.start(queue: queue)
        }
    }

    func stop() { listener.cancel() }

    private func accept(_ connection: NWConnection) {
        guard case .hostPort(let host, _) = connection.endpoint,
              host.debugDescription.contains("127.0.0.1") || host.debugDescription.contains("::ffff:127.0.0.1")
        else {
            connection.cancel()
            return
        }
        connection.start(queue: queue)
        receiveRequest(connection, accumulated: Data())
    }

    private func receiveRequest(_ connection: NWConnection, accumulated: Data) {
        let maximumFrameBytes = ProtocolLimits.maxRequestBytes + 16_384
        guard accumulated.count < maximumFrameBytes else {
            connection.cancel()
            return
        }
        connection.receive(
            minimumIncompleteLength: 1,
            maximumLength: maximumFrameBytes - accumulated.count
        ) { [weak self] data, _, isComplete, error in
            guard let self, error == nil, let data else {
                connection.cancel()
                return
            }
            var frame = accumulated
            frame.append(data)
            switch Self.parseRequest(frame) {
            case .incomplete where !isComplete:
                self.receiveRequest(connection, accumulated: frame)
            case .complete(let path, let authorization, let body):
                self.liveness.touch()
                Task {
                    let response = await self.handler.handle(
                        path: path,
                        authorization: authorization,
                        body: body
                    )
                    let bytes = Self.httpResponse(response)
                    connection.send(
                        content: bytes,
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
        guard headerRange.lowerBound <= 16_384 else { return .invalid }
        let headerData = data[..<headerRange.lowerBound]
        guard let headerText = String(data: headerData, encoding: .utf8) else { return .invalid }
        let lines = headerText.components(separatedBy: "\r\n")
        guard let first = lines.first else { return .invalid }
        let requestLine = first.split(separator: " ")
        guard requestLine.count == 3, requestLine[0] == "POST", requestLine[2] == "HTTP/1.1" else {
            return .invalid
        }
        var headers: [String: String] = [:]
        for line in lines.dropFirst() {
            guard let separator = line.firstIndex(of: ":") else { return .invalid }
            let name = line[..<separator].trimmingCharacters(in: .whitespaces).lowercased()
            let value = line[line.index(after: separator)...].trimmingCharacters(in: .whitespaces)
            headers[name] = value
        }
        guard headers["content-type"]?.lowercased().hasPrefix("application/json") == true,
              let lengthText = headers["content-length"], let length = Int(lengthText),
              length >= 0, length <= ProtocolLimits.maxRequestBytes
        else { return .invalid }
        let bodyStart = headerRange.upperBound
        let receivedBodyBytes = data.distance(from: bodyStart, to: data.endIndex)
        if receivedBodyBytes < length { return .incomplete }
        guard receivedBodyBytes == length else { return .invalid }
        return .complete(
            path: String(requestLine[1]),
            authorization: headers["authorization"],
            body: Data(data[bodyStart...])
        )
    }

    private static func httpResponse(_ response: ProtocolResponse) -> Data {
        var output = Data("HTTP/1.1 \(response.statusCode) OK\r\nContent-Type: application/json\r\nContent-Length: \(response.body.count)\r\nConnection: close\r\n\r\n".utf8)
        output.append(response.body)
        return output
    }
}
