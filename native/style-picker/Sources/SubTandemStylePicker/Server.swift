import Foundation
@preconcurrency import Network

private struct HTTPRequest {
    let method: String
    let target: String
    let headers: [String: String]
    let body: Data
}

private struct HTTPResponse {
    let status: Int
    let reason: String
    let body: Data

    func encoded() -> Data {
        var data = Data(
            "HTTP/1.1 \(status) \(reason)\r\nContent-Type: application/json\r\nContent-Length: \(body.count)\r\nConnection: close\r\n\r\n".utf8
        )
        data.append(body)
        return data
    }
}

private final class ListenerStartState: @unchecked Sendable {
    private let lock = NSLock()
    private var port: Int?
    private var failed = false

    func ready(_ port: Int?) {
        lock.lock()
        self.port = port
        lock.unlock()
    }

    func fail() {
        lock.lock()
        failed = true
        lock.unlock()
    }

    func result() -> (Int?, Bool) {
        lock.lock()
        defer { lock.unlock() }
        return (port, failed)
    }
}

final class StylePickerServer: @unchecked Sendable {
    private let token: String
    private let queue = DispatchQueue(label: "io.subtandem.style-picker.server")
    private let lifecycle = PickerLifecycle()
    private let events = PickerEventStore()
    private let catalog: FontCatalog
    private let fontPicker: FontPickerController
    private let colorPicker: ColorPickerController
    private let onShutdown: @Sendable () -> Void
    private var listener: NWListener?

    @MainActor
    init(token: String, catalog: FontCatalog, onShutdown: @escaping @Sendable () -> Void) {
        self.token = token
        self.catalog = catalog
        self.fontPicker = FontPickerController(catalog: catalog)
        self.colorPicker = ColorPickerController()
        self.onShutdown = onShutdown
        catalog.startObserving { [events] revision in
            events.append(requestId: "catalog", payload: .fontCatalogChanged(revision))
        }
    }

    func start() throws -> Int {
        let parameters = NWParameters.tcp
        parameters.requiredLocalEndpoint = .hostPort(host: "127.0.0.1", port: .any)
        let listener = try NWListener(using: parameters)
        self.listener = listener
        let ready = DispatchSemaphore(value: 0)
        let startState = ListenerStartState()
        listener.stateUpdateHandler = { state in
            switch state {
            case .ready:
                startState.ready(listener.port.map { Int($0.rawValue) })
                ready.signal()
            case .failed:
                startState.fail()
                ready.signal()
            default:
                break
            }
        }
        listener.newConnectionHandler = { [weak self] connection in
            self?.receive(connection, data: Data())
        }
        listener.start(queue: queue)
        guard ready.wait(timeout: .now() + 5) == .success else {
            listener.cancel()
            throw ProtocolError.invalid
        }
        let (readyPort, failed) = startState.result()
        guard !failed, let port = readyPort, port >= 1_024 else {
            listener.cancel()
            throw ProtocolError.invalid
        }
        return port
    }

    func stop() {
        lifecycle.shutdown()
        listener?.cancel()
        listener = nil
        Task { @MainActor [fontPicker, colorPicker] in
            fontPicker.closeForShutdown()
            colorPicker.closeForShutdown()
        }
    }

    private func activatePicker(requestId: String) {
        Task { @MainActor [fontPicker, colorPicker] in
            if colorPicker.activate(requestId: requestId) { return }
            _ = fontPicker.activate(requestId: requestId)
        }
    }

    private func receive(_ connection: NWConnection, data: Data) {
        connection.start(queue: queue)
        connection.receive(minimumIncompleteLength: 1, maximumLength: 65_536) { [weak self] chunk, _, complete, error in
            guard let self else {
                connection.cancel()
                return
            }
            var accumulated = data
            if let chunk { accumulated.append(chunk) }
            if accumulated.count > 65_536 {
                self.send(self.json(status: 413, reason: "Payload Too Large", value: ["error": "INVALID_REQUEST"]), connection)
                return
            }
            if let request = self.parseRequest(accumulated) {
                self.send(self.handle(request), connection)
                return
            }
            if complete || error != nil {
                self.send(self.json(status: 400, reason: "Bad Request", value: ["error": "INVALID_REQUEST"]), connection)
                return
            }
            self.receive(connection, data: accumulated)
        }
    }

    private func parseRequest(_ data: Data) -> HTTPRequest? {
        let delimiter = Data("\r\n\r\n".utf8)
        guard let range = data.range(of: delimiter),
              let head = String(data: data[..<range.lowerBound], encoding: .utf8) else { return nil }
        let lines = head.components(separatedBy: "\r\n")
        guard let requestLine = lines.first else { return nil }
        let parts = requestLine.split(separator: " ")
        guard parts.count == 3, parts[2] == "HTTP/1.1" else { return nil }
        var headers: [String: String] = [:]
        for line in lines.dropFirst() {
            guard let separator = line.firstIndex(of: ":") else { return nil }
            let key = line[..<separator].trimmingCharacters(in: .whitespaces).lowercased()
            let value = line[line.index(after: separator)...].trimmingCharacters(in: .whitespaces)
            guard headers[key] == nil else { return nil }
            headers[key] = value
        }
        let contentLength = Int(headers["content-length"] ?? "0") ?? -1
        guard contentLength >= 0, contentLength <= 65_536 else { return nil }
        let bodyStart = range.upperBound
        guard data.count >= bodyStart + contentLength else { return nil }
        let body = data.subdata(in: bodyStart..<(bodyStart + contentLength))
        return HTTPRequest(method: String(parts[0]), target: String(parts[1]), headers: headers, body: body)
    }

    private func handle(_ request: HTTPRequest) -> HTTPResponse {
        guard ProtocolValidator.authorized(headers: request.headers, token: token) else {
            return json(status: 401, reason: "Unauthorized", value: ["error": "UNAUTHORIZED"])
        }
        if request.method == "GET", request.target.hasPrefix("/v1/events?after=") {
            let raw = String(request.target.dropFirst("/v1/events?after=".count))
            guard let after = Int(raw), after >= 0 else {
                return json(status: 400, reason: "Bad Request", value: ["error": "INVALID_REQUEST"])
            }
            return encoded(events.events(after: after))
        }
        guard request.method == "POST",
              request.headers["content-type"]?.lowercased().hasPrefix("application/json") == true else {
            return json(status: 404, reason: "Not Found", value: ["error": "NOT_FOUND"])
        }
        do {
            switch request.target {
            case "/v1/color/open":
                let input = try ProtocolValidator.decodeColorOpen(request.body)
                guard lifecycle.open(requestId: input.requestId) else {
                    if let requestId = lifecycle.currentRequestId() {
                        activatePicker(requestId: requestId)
                    }
                    return json(value: ["status": "focused"])
                }
                Task { @MainActor [colorPicker, lifecycle, events] in
                    colorPicker.open(
                        request: input,
                        onPreview: { color in
                            guard lifecycle.isActive(requestId: input.requestId) else { return }
                            events.append(requestId: input.requestId, payload: .colorPreview(color))
                        },
                        onClose: { result in
                            guard lifecycle.complete(requestId: input.requestId) else { return }
                            events.append(
                                requestId: input.requestId,
                                payload: .colorClosed(result.changed, result.color)
                            )
                        }
                    )
                }
                return json(value: ["status": "opened"])
            case "/v1/font/open":
                let input = try ProtocolValidator.decodeFontOpen(request.body)
                guard lifecycle.open(requestId: input.requestId) else {
                    if let requestId = lifecycle.currentRequestId() {
                        activatePicker(requestId: requestId)
                    }
                    return json(value: ["status": "focused"])
                }
                Task { @MainActor [fontPicker, lifecycle, events] in
                    fontPicker.open(request: input) { family, confirmed in
                        guard lifecycle.complete(requestId: input.requestId) else { return }
                        events.append(
                            requestId: input.requestId,
                            payload: confirmed ? .fontConfirmed(family) : .fontCancelled
                        )
                    }
                }
                return json(value: ["status": "opened"])
            case "/v1/font/status":
                let input = try ProtocolValidator.decodeFontStatus(request.body)
                return encoded(catalog.status(for: input.fontFamily))
            case "/v1/activate":
                let input = try ProtocolValidator.decodeRequestId(request.body)
                guard lifecycle.activate(requestId: input.requestId) else {
                    return json(value: ["status": "unchanged"])
                }
                activatePicker(requestId: input.requestId)
                return json(value: ["status": "activated"])
            case "/v1/cancel":
                let input = try ProtocolValidator.decodeRequestId(request.body)
                guard lifecycle.cancel(requestId: input.requestId) else {
                    return json(value: ["status": "unchanged"])
                }
                Task { @MainActor [fontPicker, colorPicker, events] in
                    if let original = colorPicker.cancel(requestId: input.requestId) {
                        events.append(
                            requestId: input.requestId,
                            payload: .colorClosed(false, original)
                        )
                    } else {
                        fontPicker.cancel(requestId: input.requestId)
                        events.append(requestId: input.requestId, payload: .fontCancelled)
                    }
                }
                return json(value: ["status": "cancelled"])
            case "/v1/shutdown":
                try ProtocolValidator.decodeEmpty(request.body)
                lifecycle.shutdown()
                queue.asyncAfter(deadline: .now() + 0.1) { [weak self] in
                    self?.stop()
                    self?.onShutdown()
                }
                return json(value: ["status": "shutting-down"])
            default:
                return json(status: 404, reason: "Not Found", value: ["error": "NOT_FOUND"])
            }
        } catch {
            return json(status: 400, reason: "Bad Request", value: ["error": "INVALID_REQUEST"])
        }
    }

    private func send(_ response: HTTPResponse, _ connection: NWConnection) {
        connection.send(content: response.encoded(), completion: .contentProcessed { _ in
            connection.cancel()
        })
    }

    private func encoded<T: Encodable>(_ value: T) -> HTTPResponse {
        do {
            return HTTPResponse(status: 200, reason: "OK", body: try JSONEncoder().encode(value))
        } catch {
            return json(status: 500, reason: "Internal Server Error", value: ["error": "PICKER_UNAVAILABLE"])
        }
    }

    private func json(
        status: Int = 200,
        reason: String = "OK",
        value: [String: String]
    ) -> HTTPResponse {
        let body = (try? JSONSerialization.data(withJSONObject: value, options: [.sortedKeys])) ?? Data("{}".utf8)
        return HTTPResponse(status: status, reason: reason, body: body)
    }
}
