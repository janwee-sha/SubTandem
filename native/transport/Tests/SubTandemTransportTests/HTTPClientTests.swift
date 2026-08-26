import Foundation
import Network

final class DirectCaptureServer: @unchecked Sendable {
    private let listener: NWListener
    private let queue = DispatchQueue(label: "io.subtandem.transport.tests.direct")
    private let lock = NSLock()
    private let immediateResponses: Bool
    private var readyContinuation: CheckedContinuation<UInt16, Error>?
    private var capturedHeaders: [String] = []
    private var pendingConnections: [NWConnection] = []
    private var activeConnections: [ObjectIdentifier: NWConnection] = [:]
    private var totalAccepted = 0

    init(immediateResponses: Bool = false) throws {
        self.immediateResponses = immediateResponses
        let parameters = NWParameters.tcp
        parameters.requiredLocalEndpoint = .hostPort(host: "127.0.0.1", port: .any)
        parameters.allowLocalEndpointReuse = false
        listener = try NWListener(using: parameters)
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
        let connections = lock.withLock {
            let connections = Array(activeConnections.values)
            pendingConnections.removeAll()
            activeConnections.removeAll()
            return connections
        }
        for connection in connections { connection.cancel() }
    }

    func waitUntilReceived(_ count: Int) async -> Bool {
        for _ in 0..<200 {
            if receivedCount() >= count { return true }
            try? await Task.sleep(for: .milliseconds(5))
        }
        return false
    }

    func receivedCount() -> Int { lock.withLock { capturedHeaders.count } }

    func acceptedCount() -> Int { lock.withLock { totalAccepted } }

    func noConnectionHeadersRequestClose() -> Bool {
        lock.withLock {
            capturedHeaders.allSatisfy { headers in
                !headers.components(separatedBy: "\r\n").contains { line in
                    line.lowercased() == "connection: close"
                }
            }
        }
    }

    func completeAll() {
        let connections = lock.withLock {
            let connections = pendingConnections
            pendingConnections.removeAll()
            return connections
        }
        let body = Data("{}".utf8)
        let response = Data(
            "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: \(body.count)\r\nConnection: keep-alive\r\n\r\n".utf8
        ) + body
        for connection in connections {
            connection.send(content: response, completion: .contentProcessed { _ in
                connection.cancel()
            })
        }
    }

    private func accept(_ connection: NWConnection) {
        lock.withLock {
            activeConnections[ObjectIdentifier(connection)] = connection
            totalAccepted += 1
        }
        connection.start(queue: queue)
        receive(connection, accumulated: Data())
    }

    private func receive(_ connection: NWConnection, accumulated: Data) {
        connection.receive(minimumIncompleteLength: 1, maximumLength: 64 * 1_024) {
            [weak self] data, _, isComplete, error in
            guard let self, error == nil, let data else {
                connection.cancel()
                return
            }
            var frame = accumulated
            frame.append(data)
            switch TransportServer.parseRequest(frame) {
            case .incomplete where !isComplete:
                self.receive(connection, accumulated: frame)
            case .complete:
                let marker = Data("\r\n\r\n".utf8)
                guard let range = frame.range(of: marker),
                      let headers = String(data: frame[..<range.lowerBound], encoding: .utf8)
                else {
                    connection.cancel()
                    return
                }
                self.lock.withLock {
                    self.capturedHeaders.append(headers)
                }
                if self.immediateResponses {
                    self.sendKeepAliveResponse(connection)
                } else {
                    self.lock.withLock { self.pendingConnections.append(connection) }
                }
            default:
                connection.cancel()
            }
        }
    }

    private func sendKeepAliveResponse(_ connection: NWConnection) {
        let body = Data("{}".utf8)
        let response = Data(
            "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: \(body.count)\r\nConnection: keep-alive\r\n\r\n".utf8
        ) + body
        connection.send(content: response, completion: .contentProcessed { [weak self] error in
            guard let self, error == nil else {
                connection.cancel()
                return
            }
            self.receive(connection, accumulated: Data())
        })
    }
}

final class BlockingURLProtocol: URLProtocol, @unchecked Sendable {
    private static let lock = NSLock()
    nonisolated(unsafe) private static var active: [ObjectIdentifier: BlockingURLProtocol] = [:]
    nonisolated(unsafe) private static var totalStarted = 0
    nonisolated(unsafe) private static var connectionHeaders: [String?] = []

    override class func canInit(with request: URLRequest) -> Bool { true }

    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }

    override func startLoading() {
        Self.lock.withLock {
            Self.active[ObjectIdentifier(self)] = self
            Self.totalStarted += 1
            Self.connectionHeaders.append(request.value(forHTTPHeaderField: "Connection"))
        }
    }

    override func stopLoading() {
        let removed = Self.lock.withLock {
            Self.active.removeValue(forKey: ObjectIdentifier(self)) != nil
        }
        if removed { client?.urlProtocol(self, didFailWithError: URLError(.cancelled)) }
    }

    static func reset() {
        lock.withLock {
            active.removeAll()
            totalStarted = 0
            connectionHeaders.removeAll()
        }
    }

    static func startedCount() -> Int { lock.withLock { totalStarted } }

    static func capturedConnectionHeaders() -> [String?] { lock.withLock { connectionHeaders } }

    static func waitUntilStarted(_ count: Int) async -> Bool {
        for _ in 0..<200 {
            if startedCount() >= count { return true }
            try? await Task.sleep(for: .milliseconds(5))
        }
        return false
    }

    static func completeAll(body: Data = Data("{}".utf8)) {
        let protocols = lock.withLock {
            let values = Array(active.values)
            active.removeAll()
            return values
        }
        for item in protocols { complete(item, body: body) }
    }

    static func completeOne(body: Data = Data("{}".utf8)) -> Bool {
        let item = lock.withLock { () -> BlockingURLProtocol? in
            guard let entry = active.first else { return nil }
            active.removeValue(forKey: entry.key)
            return entry.value
        }
        guard let item else { return false }
        complete(item, body: body)
        return true
    }

    private static func complete(_ item: BlockingURLProtocol, body: Data) {
        let response = HTTPURLResponse(
            url: item.request.url!,
            statusCode: 200,
            httpVersion: "HTTP/1.1",
            headerFields: ["Content-Type": "application/json"]
        )!
        item.client?.urlProtocol(item, didReceive: response, cacheStoragePolicy: .notAllowed)
        item.client?.urlProtocol(item, didLoad: body)
        item.client?.urlProtocolDidFinishLoading(item)
    }
}

func makeControlledHTTPClient() -> HTTPClient {
    let configuration = URLSessionConfiguration.ephemeral
    configuration.protocolClasses = [BlockingURLProtocol.self]
    return HTTPClient(systemConfiguration: configuration)
}

func makeTransportRequest(
    jobID: String = UUID().uuidString,
    maximumResponseBytes: Int = 1_024
) -> TransportRequest {
    TransportRequest(
        jobID: jobID,
        method: "POST",
        url: "https://provider.example/v1",
        headers: [:],
        proxyMode: "system",
        body: Data("{}".utf8),
        timeoutMilliseconds: 5_000,
        maxResponseBytes: maximumResponseBytes
    )
}

func makeDirectTransportRequest(port: UInt16) -> TransportRequest {
    TransportRequest(
        jobID: UUID().uuidString,
        method: "POST",
        url: "http://127.0.0.1:\(port)/v1",
        headers: ["Content-Type": "application/json", "Connection": "close"],
        proxyMode: "direct",
        body: Data("{}".utf8),
        timeoutMilliseconds: 5_000,
        maxResponseBytes: 1_024
    )
}

func encodedTransportRequest(jobID: String) throws -> Data {
    try JSONSerialization.data(withJSONObject: [
        "jobId": jobID,
        "method": "POST",
        "url": "https://provider.example/v1",
        "headers": [:],
        "proxyMode": "system",
        "body": [:],
        "timeoutMs": 5_000,
        "maxResponseBytes": 1_024,
    ])
}

func runHTTPClientTests() async throws {
    let sanitizedEnvironment = ProxyEnvironment.sanitized([
        "PATH": "/usr/bin",
        "HTTPS_PROXY": "http://127.0.0.1:10808",
        "all_proxy": "socks5://127.0.0.1:10808",
        "NO_PROXY": "localhost",
    ])
    try check(
        sanitizedEnvironment == ["PATH": "/usr/bin", "NO_PROXY": "localhost"],
        "the helper must relaunch without inherited HTTP/SOCKS proxy variables"
    )

    try UpstreamPolicy.validate(URL(string: "https://provider.example/v1")!)
    try UpstreamPolicy.validate(URL(string: "http://127.0.0.1:11434/api/chat")!)
    try UpstreamPolicy.validate(URL(string: "http://provider.example/v1")!)
    try UpstreamPolicy.validate(URL(string: "http://192.168.50.4:8080/v1")!)
    try expectFailure("URL credentials must be rejected") {
        try UpstreamPolicy.validate(URL(string: "https://user:pass@provider.example/v1")!)
    }
    try expectFailure("non-HTTP schemes must be rejected") {
        try UpstreamPolicy.validate(URL(string: "file:///tmp/private")!)
    }

    let original = URL(string: "https://provider.example/v1")!
    try check(UpstreamPolicy.sameOrigin(original, URL(string: "https://provider.example/v2")!), "same-origin redirect should be allowed")
    try check(!UpstreamPolicy.sameOrigin(original, URL(string: "https://evil.example/v2")!), "cross-origin redirect must be rejected")

    let selected = UpstreamPolicy.selectedHeaders([
        "Retry-After": "2",
        "X-Request-ID": "safe-id",
        "Authorization": "secret",
        "Set-Cookie": "secret-cookie",
    ])
    try check(selected == ["retry-after": "2", "x-request-id": "safe-id"], "response headers must be allowlisted")

    let client = HTTPClient()
    try check(
        HTTPClient.transportKind(for: "direct") == .libcurl,
        "direct mode must use the explicit no-proxy libcurl transport"
    )
    try check(
        HTTPClient.transportKind(for: "system") == .urlSession,
        "system mode must continue to use macOS URLSession proxy settings"
    )
    try check(
        HTTPClient.maximumConnectionsPerHost == 4,
        "the shared system session must cap each host at four connections"
    )
    try check(
        client.systemSessionMaximumConnectionsPerHost() == 4,
        "the configured system session must apply the host connection cap"
    )
    try check(
        client.systemSessionIdentity() == client.systemSessionIdentity(),
        "system requests must reuse one helper-owned session"
    )
    let cancellation = await client.cancel(jobID: "unknown")
    try check(cancellation == .unknown, "cancellation must address the exact job")
    try expectFailure("invalid jobs must fail before transport") {
        _ = try TransportRequest(
            jobID: "",
            method: "POST",
            url: "https://example.test",
            headers: [:],
            proxyMode: "system",
            body: Data(),
            timeoutMilliseconds: 1_000,
            maxResponseBytes: 1_024
        ).validated()
    }

    try check(
        HTTPClient.classify(URLError(.timedOut)) == .timedOut,
        "upstream timeouts must retain a safe timeout classification"
    )
    try check(
        HTTPClient.classify(URLError(.cannotConnectToHost)) == .upstreamNetwork,
        "upstream connection failures must retain a safe network classification"
    )
    let timeoutResponse = ProtocolHandler.errorResponse(for: TransportProtocolError.timedOut)
    try check(timeoutResponse.statusCode == 504, "timeout RPC responses must use 504")
    try check(
        String(decoding: timeoutResponse.body, as: UTF8.self).contains("upstream-timeout"),
        "timeout RPC responses must expose only the stable safe code"
    )

    let redirectSession = URLSession(configuration: .ephemeral)
    let redirectTask = redirectSession.dataTask(with: original)
    let redirectResponse = HTTPURLResponse(
        url: original,
        statusCode: 302,
        httpVersion: "HTTP/1.1",
        headerFields: nil
    )!
    let redirectDelegate = RedirectDelegate(originalURL: original)
    for index in 1...3 {
        var decision: URLRequest?
        redirectDelegate.urlSession(
            redirectSession,
            task: redirectTask,
            willPerformHTTPRedirection: redirectResponse,
            newRequest: URLRequest(url: URL(string: "https://provider.example/v\(index + 1)")!),
            completionHandler: { decision = $0 }
        )
        try check(decision != nil, "each request must allow its first three same-origin redirects")
    }
    var fourthDecision: URLRequest?
    redirectDelegate.urlSession(
        redirectSession,
        task: redirectTask,
        willPerformHTTPRedirection: redirectResponse,
        newRequest: URLRequest(url: URL(string: "https://provider.example/v5")!),
        completionHandler: { fourthDecision = $0 }
    )
    try check(fourthDecision == nil, "redirect limits must be scoped to one request")
    let independentDelegate = RedirectDelegate(originalURL: original)
    var independentDecision: URLRequest?
    independentDelegate.urlSession(
        redirectSession,
        task: redirectTask,
        willPerformHTTPRedirection: redirectResponse,
        newRequest: URLRequest(url: URL(string: "https://provider.example/independent")!),
        completionHandler: { independentDecision = $0 }
    )
    try check(independentDecision != nil, "a different request must have an independent redirect count")
    var crossOriginDecision: URLRequest?
    independentDelegate.urlSession(
        redirectSession,
        task: redirectTask,
        willPerformHTTPRedirection: redirectResponse,
        newRequest: URLRequest(url: URL(string: "https://other.example/v1")!),
        completionHandler: { crossOriginDecision = $0 }
    )
    try check(crossOriginDecision == nil, "cross-origin redirects must remain rejected")
    for blockedTarget in [
        "http://provider.example/v1",
        "https://provider.example:444/v1",
        "https://user:pass@provider.example/v1",
        "https://provider.example/v1#fragment",
    ] {
        let delegate = RedirectDelegate(originalURL: original)
        var decision: URLRequest?
        delegate.urlSession(
            redirectSession,
            task: redirectTask,
            willPerformHTTPRedirection: redirectResponse,
            newRequest: URLRequest(url: URL(string: blockedTarget)!),
            completionHandler: { decision = $0 }
        )
        try check(decision == nil, "redirect targets must be structurally valid and same-origin")
    }
    redirectSession.invalidateAndCancel()

    let directServer = try DirectCaptureServer()
    let directPort = try await directServer.start()
    let directClient = HTTPClient()
    defer {
        directServer.completeAll()
        directServer.stop()
        directClient.close()
    }
    let directRequests = (0..<5).map { _ in makeDirectTransportRequest(port: directPort) }
    let directWork = directRequests.prefix(4).map { request in
        Task { try await directClient.perform(request) }
    }
    let directAllowanceFilled = await directServer.waitUntilReceived(4)
    try check(directAllowanceFilled, "four direct requests should fill the shared host allowance")
    let directQueuedWork = Task { try await directClient.perform(directRequests[4]) }
    try? await Task.sleep(for: .milliseconds(100))
    try check(
        directServer.receivedCount() == HTTPClient.maximumConnectionsPerHost,
        "a fifth direct request must remain outside libcurl while four same-host requests are active"
    )
    try check(
        directClient.upstreamActiveRequestCount(host: "127.0.0.1") == 4 &&
            directClient.upstreamWaitingRequestCount(host: "127.0.0.1") == 1,
        "direct requests must use the same exact, cancellable host request gate"
    )
    try check(
        directServer.noConnectionHeadersRequestClose(),
        "direct requests must leave completed connections reusable by the bounded client pool"
    )
    let directQueuedCancellation = await directClient.cancel(jobID: directRequests[4].jobID)
    try check(
        directQueuedCancellation == .cancelled,
        "a queued direct request must retain exact cancellation identity"
    )
    directServer.completeAll()
    for task in directWork { _ = try await task.value }
    do {
        _ = try await directQueuedWork.value
        throw ContractTestFailure(description: "a cancelled queued direct request must not complete")
    } catch is CancellationError {}

    let reuseServer = try DirectCaptureServer(immediateResponses: true)
    let reusePort = try await reuseServer.start()
    let reuseClient = HTTPClient()
    defer {
        reuseServer.stop()
        reuseClient.close()
    }
    for _ in 0..<25 {
        let response = try await reuseClient.perform(makeDirectTransportRequest(port: reusePort))
        try check(response.statusCode == 200, "each sequential direct request must complete")
    }
    try check(reuseServer.receivedCount() == 25, "the reuse test must complete all direct requests")
    try check(
        reuseServer.acceptedCount() == 1,
        "sequential direct requests to one origin must reuse one bounded connection"
    )

    BlockingURLProtocol.reset()
    let controlledClient = makeControlledHTTPClient()
    let requests = (0..<5).map { _ in makeTransportRequest() }
    let activeWork = requests.prefix(4).map { request in
        Task { try await controlledClient.perform(request) }
    }
    let reachedConnectionAllowance = await BlockingURLProtocol.waitUntilStarted(4)
    try check(
        reachedConnectionAllowance,
        "four requests should be able to occupy the host connection allowance"
    )
    let queuedWork = Task { try await controlledClient.perform(requests[4]) }
    for _ in 0..<200 {
        if controlledClient.upstreamWaitingRequestCount(host: "provider.example") == 1 { break }
        try? await Task.sleep(for: .milliseconds(5))
    }
    try await Task.sleep(for: .milliseconds(50))
    try check(
        BlockingURLProtocol.startedCount() == HTTPClient.maximumConnectionsPerHost,
        "a fifth same-host request must remain outside the transport while four requests are active"
    )
    try check(
        controlledClient.upstreamActiveRequestCount(host: "provider.example") == 4 &&
            controlledClient.upstreamWaitingRequestCount(host: "provider.example") == 1,
        "the explicit host request gate must own four permits and one exact waiter"
    )
    try check(
        BlockingURLProtocol.capturedConnectionHeaders().allSatisfy { $0 == nil },
        "system-proxy requests must leave completed connections reusable by the bounded session"
    )
    let queuedCancellation = await controlledClient.cancel(jobID: requests[4].jobID)
    try check(queuedCancellation == .cancelled, "a queued request must retain exact cancellation identity")
    BlockingURLProtocol.completeAll()
    for task in activeWork {
        let response = try await task.value
        try check(response.statusCode == 200, "cancelling one request must not affect its peers")
    }
    do {
        _ = try await queuedWork.value
        throw ContractTestFailure(description: "a cancelled queued request must not complete successfully")
    } catch is CancellationError {}
    let repeatedCancellation = await controlledClient.cancel(jobID: requests[4].jobID)
    try check(
        repeatedCancellation == .alreadyCompleted,
        "completion and cancellation must produce one stable terminal state"
    )
    controlledClient.close()

    BlockingURLProtocol.reset()
    let advancingClient = makeControlledHTTPClient()
    let advancingRequests = (0..<5).map { _ in makeTransportRequest() }
    let firstWave = advancingRequests.prefix(4).map { request in
        Task { try await advancingClient.perform(request) }
    }
    let firstWaveStarted = await BlockingURLProtocol.waitUntilStarted(4)
    try check(firstWaveStarted, "the advancement test must fill the host request gate")
    let waitingWork = Task { try await advancingClient.perform(advancingRequests[4]) }
    for _ in 0..<200 {
        if advancingClient.upstreamWaitingRequestCount(host: "provider.example") == 1 { break }
        try? await Task.sleep(for: .milliseconds(5))
    }
    try check(BlockingURLProtocol.completeOne(), "one active request must be available to finish")
    let waitingRequestStarted = await BlockingURLProtocol.waitUntilStarted(5)
    try check(
        waitingRequestStarted,
        "finishing one request must admit the next uncancelled same-host waiter"
    )
    BlockingURLProtocol.completeAll()
    for task in firstWave { _ = try await task.value }
    _ = try await waitingWork.value
    advancingClient.close()

    BlockingURLProtocol.reset()
    let sizeClient = makeControlledHTTPClient()
    let sizeTask = Task {
        try await sizeClient.perform(makeTransportRequest(maximumResponseBytes: 1))
    }
    let sizeRequestStarted = await BlockingURLProtocol.waitUntilStarted(1)
    try check(sizeRequestStarted, "the response-size test must reach the shared session")
    BlockingURLProtocol.completeAll()
    do {
        _ = try await sizeTask.value
        throw ContractTestFailure(description: "oversized system responses must be rejected")
    } catch TransportProtocolError.responseTooLarge {}
    sizeClient.close()

    BlockingURLProtocol.reset()
    let immediateCancellationClient = makeControlledHTTPClient()
    let immediateTask = Task {
        try await immediateCancellationClient.perform(makeTransportRequest())
    }
    immediateTask.cancel()
    do {
        _ = try await immediateTask.value
        throw ContractTestFailure(description: "immediate cancellation must not start a successful request")
    } catch is CancellationError {}
    try check(
        immediateCancellationClient.activeJobCount() == 0,
        "cancellation before network task installation must clear the exact job"
    )
    immediateCancellationClient.close()
}
