@preconcurrency import Foundation

enum ProxyEnvironment {
    static let inheritedNames = [
        "HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY",
        "http_proxy", "https_proxy", "all_proxy",
    ]

    static func sanitized(_ environment: [String: String]) -> [String: String] {
        environment.filter { !inheritedNames.contains($0.key) }
    }
}

enum UpstreamPolicy {
    static func validate(_ url: URL) throws {
        guard url.user == nil, url.password == nil, url.fragment == nil,
              let scheme = url.scheme?.lowercased(), let host = url.host?.lowercased(),
              !host.isEmpty, ["http", "https"].contains(scheme)
        else { throw TransportProtocolError.forbiddenDestination }
    }

    static func sameOrigin(_ lhs: URL, _ rhs: URL) -> Bool {
        lhs.scheme?.lowercased() == rhs.scheme?.lowercased()
            && lhs.host?.lowercased() == rhs.host?.lowercased()
            && effectivePort(lhs) == effectivePort(rhs)
    }

    static func selectedHeaders(_ headers: [AnyHashable: Any]) -> [String: String] {
        let allowed = Set(["retry-after", "x-request-id", "content-type"])
        return headers.reduce(into: [:]) { result, pair in
            let name = String(describing: pair.key).lowercased()
            guard allowed.contains(name) else { return }
            let value = String(describing: pair.value)
            guard value.count <= 1_024, !value.contains("\n"), !value.contains("\r") else { return }
            result[name] = value
        }
    }

    private static func effectivePort(_ url: URL) -> Int? {
        url.port ?? (url.scheme?.lowercased() == "https" ? 443 : 80)
    }
}

final class RedirectDelegate: NSObject, URLSessionTaskDelegate, @unchecked Sendable {
    private let originalURL: URL
    private let lock = NSLock()
    private var redirects = 0

    init(originalURL: URL) { self.originalURL = originalURL }

    func urlSession(
        _ session: URLSession,
        task: URLSessionTask,
        willPerformHTTPRedirection response: HTTPURLResponse,
        newRequest request: URLRequest,
        completionHandler: @escaping (URLRequest?) -> Void
    ) {
        let redirectCount = lock.withLock {
            redirects += 1
            return redirects
        }
        guard redirectCount <= 3, let target = request.url,
              (try? UpstreamPolicy.validate(target)) != nil,
              UpstreamPolicy.sameOrigin(originalURL, target)
        else {
            completionHandler(nil)
            return
        }
        completionHandler(request)
    }
}

final class HostRequestLimiter: @unchecked Sendable {
    final class Permit: @unchecked Sendable {
        private let lock = NSLock()
        private var releaseOperation: (@Sendable () -> Void)?

        init(release: @escaping @Sendable () -> Void) {
            releaseOperation = release
        }

        func release() {
            let operation = lock.withLock {
                let operation = releaseOperation
                releaseOperation = nil
                return operation
            }
            operation?()
        }

        deinit { release() }
    }

    private struct Waiter {
        let id: UUID
        let continuation: CheckedContinuation<Permit, Error>
    }

    private struct HostState {
        var active = 0
        var waiters: [Waiter] = []
    }

    private enum Admission {
        case acquired
        case queued
        case cancelled
    }

    private let maximumActiveRequests: Int
    private let lock = NSLock()
    private var hosts: [String: HostState] = [:]
    private var closed = false

    init(maximumActiveRequests: Int) {
        precondition(maximumActiveRequests > 0)
        self.maximumActiveRequests = maximumActiveRequests
    }

    func acquire(host: String) async throws -> Permit {
        let waiterID = UUID()
        let permit = try await withTaskCancellationHandler {
            try await withCheckedThrowingContinuation { continuation in
                let admission = lock.withLock { () -> Admission in
                    guard !closed, !Task<Never, Never>.isCancelled else { return .cancelled }
                    var state = hosts[host] ?? HostState()
                    guard state.active < maximumActiveRequests else {
                        state.waiters.append(Waiter(id: waiterID, continuation: continuation))
                        hosts[host] = state
                        return .queued
                    }
                    state.active += 1
                    hosts[host] = state
                    return .acquired
                }
                switch admission {
                case .acquired:
                    continuation.resume(returning: makePermit(host: host))
                case .cancelled:
                    continuation.resume(throwing: CancellationError())
                case .queued:
                    break
                }
            }
        } onCancel: {
            self.cancel(host: host, waiterID: waiterID)
        }
        guard !Task<Never, Never>.isCancelled else {
            permit.release()
            throw CancellationError()
        }
        return permit
    }

    func close() {
        let continuations = lock.withLock { () -> [CheckedContinuation<Permit, Error>] in
            guard !closed else { return [] }
            closed = true
            var continuations: [CheckedContinuation<Permit, Error>] = []
            var remaining: [String: HostState] = [:]
            for (host, var state) in hosts {
                continuations.append(contentsOf: state.waiters.map(\.continuation))
                state.waiters.removeAll()
                if state.active > 0 { remaining[host] = state }
            }
            hosts = remaining
            return continuations
        }
        for continuation in continuations {
            continuation.resume(throwing: CancellationError())
        }
    }

    func activeCount(host: String) -> Int {
        lock.withLock { hosts[host]?.active ?? 0 }
    }

    func waitingCount(host: String) -> Int {
        lock.withLock { hosts[host]?.waiters.count ?? 0 }
    }

    private func makePermit(host: String) -> Permit {
        Permit { self.release(host: host) }
    }

    private func cancel(host: String, waiterID: UUID) {
        let continuation = lock.withLock { () -> CheckedContinuation<Permit, Error>? in
            guard var state = hosts[host],
                  let index = state.waiters.firstIndex(where: { $0.id == waiterID })
            else { return nil }
            let continuation = state.waiters.remove(at: index).continuation
            if state.active == 0 && state.waiters.isEmpty { hosts.removeValue(forKey: host) }
            else { hosts[host] = state }
            return continuation
        }
        continuation?.resume(throwing: CancellationError())
    }

    private func release(host: String) {
        let next = lock.withLock { () -> CheckedContinuation<Permit, Error>? in
            guard var state = hosts[host], state.active > 0 else { return nil }
            guard !closed, !state.waiters.isEmpty else {
                state.active -= 1
                if state.active == 0 && state.waiters.isEmpty { hosts.removeValue(forKey: host) }
                else { hosts[host] = state }
                return nil
            }
            let continuation = state.waiters.removeFirst().continuation
            hosts[host] = state
            return continuation
        }
        next?.resume(returning: makePermit(host: host))
    }
}

final class HTTPClient: @unchecked Sendable {
    static let maximumConnectionsPerHost = 4

    enum TransportKind: Equatable {
        case urlSession
        case libcurl
    }

    private final class ActiveJob: @unchecked Sendable {
        private let lock = NSLock()
        private var cancelOperation: (@Sendable () -> Void)?
        private var cancellationRequested = false

        func install(cancel operation: @escaping @Sendable () -> Void) {
            let cancelImmediately = lock.withLock {
                if cancellationRequested { return true }
                cancelOperation = operation
                return false
            }
            if cancelImmediately { operation() }
        }

        func cancel() {
            let operation = lock.withLock { () -> (@Sendable () -> Void)? in
                guard !cancellationRequested else { return nil }
                cancellationRequested = true
                let operation = cancelOperation
                cancelOperation = nil
                return operation
            }
            operation?()
        }
    }

    private enum RegistrationResult {
        case accepted(ActiveJob)
        case duplicate
        case closed
    }

    private let lock = NSLock()
    private let systemSession: URLSession
    private let directTransport: DirectCurlTransport
    private let upstreamRequestLimiter: HostRequestLimiter
    private var active: [String: ActiveJob] = [:]
    private var completed: Set<String> = []
    private var acceptingRequests = true

    init(systemConfiguration: URLSessionConfiguration = .ephemeral) {
        systemConfiguration.timeoutIntervalForRequest = Double(ProtocolLimits.maxTimeoutMilliseconds) / 1_000
        systemConfiguration.timeoutIntervalForResource = Double(ProtocolLimits.maxTimeoutMilliseconds) / 1_000
        systemConfiguration.httpShouldSetCookies = false
        systemConfiguration.urlCache = nil
        systemConfiguration.httpMaximumConnectionsPerHost = Self.maximumConnectionsPerHost
        systemSession = URLSession(configuration: systemConfiguration)
        directTransport = DirectCurlTransport()
        upstreamRequestLimiter = HostRequestLimiter(
            maximumActiveRequests: Self.maximumConnectionsPerHost
        )
    }

    static func classify(_ error: URLError) -> TransportProtocolError {
        error.code == .timedOut ? .timedOut : .upstreamNetwork
    }

    static func transportKind(for proxyMode: String) -> TransportKind {
        proxyMode == "direct" ? .libcurl : .urlSession
    }

    func perform(_ rawRequest: TransportRequest) async throws -> TransportResponse {
        let request = try rawRequest.validated()
        let job = try register(jobID: request.jobID)
        return try await withTaskCancellationHandler {
            do {
                let response = try await Self.transportKind(for: request.proxyMode) == .libcurl
                    ? performDirect(request, job: job)
                    : performURLSession(request, job: job)
                guard finish(jobID: request.jobID) else { throw CancellationError() }
                return response
            } catch {
                guard finish(jobID: request.jobID) else { throw CancellationError() }
                throw error
            }
        } onCancel: {
            _ = self.cancelSync(jobID: request.jobID)
        }
    }

    private func performURLSession(
        _ request: TransportRequest,
        job: ActiveJob
    ) async throws -> TransportResponse {
        guard let url = URL(string: request.url) else { throw TransportProtocolError.invalidRequest }
        var urlRequest = URLRequest(url: url)
        urlRequest.httpMethod = request.method
        urlRequest.httpBody = request.body.isEmpty ? nil : request.body
        urlRequest.timeoutInterval = Double(request.timeoutMilliseconds) / 1_000
        for (name, value) in request.headers { urlRequest.setValue(value, forHTTPHeaderField: name) }
        urlRequest.setValue(nil, forHTTPHeaderField: "Connection")

        let delegate = RedirectDelegate(originalURL: url)
        let task = Task {
            let permit = try await upstreamRequestLimiter.acquire(host: url.host?.lowercased() ?? "")
            defer { permit.release() }
            try Task.checkCancellation()
            return try await systemSession.data(for: urlRequest, delegate: delegate)
        }
        job.install { task.cancel() }
        do {
            let (body, response) = try await task.value
            guard let http = response as? HTTPURLResponse else {
                throw TransportProtocolError.invalidRequest
            }
            guard body.count <= request.maxResponseBytes else {
                throw TransportProtocolError.responseTooLarge
            }
            return TransportResponse(
                jobID: request.jobID,
                transportState: "completed",
                statusCode: http.statusCode,
                headers: UpstreamPolicy.selectedHeaders(http.allHeaderFields),
                body: body
            )
        } catch let error as URLError {
            throw error.code == .cancelled ? CancellationError() : Self.classify(error)
        } catch is CancellationError {
            throw CancellationError()
        } catch let error as TransportProtocolError {
            throw error
        } catch {
            throw TransportProtocolError.upstreamNetwork
        }
    }

    private func performDirect(
        _ request: TransportRequest,
        job: ActiveJob
    ) async throws -> TransportResponse {
        guard let url = URL(string: request.url), let host = url.host?.lowercased() else {
            throw TransportProtocolError.invalidRequest
        }
        let context = CurlRequestContext(maximumResponseBytes: request.maxResponseBytes)
        let requestLimiter = upstreamRequestLimiter
        let transport = directTransport
        let task = Task {
            let permit = try await requestLimiter.acquire(host: host)
            defer { permit.release() }
            try Task.checkCancellation()
            return try await transport.perform(request, context: context)
        }
        job.install {
            context.cancel()
            task.cancel()
        }
        return try await task.value
    }

    func cancel(jobID: String) async -> CancelState { cancelSync(jobID: jobID) }

    func activeJobCount() -> Int { lock.withLock { active.count } }

    func systemSessionMaximumConnectionsPerHost() -> Int {
        systemSession.configuration.httpMaximumConnectionsPerHost
    }

    func systemSessionIdentity() -> ObjectIdentifier { ObjectIdentifier(systemSession) }

    func upstreamActiveRequestCount(host: String) -> Int {
        upstreamRequestLimiter.activeCount(host: host.lowercased())
    }

    func upstreamWaitingRequestCount(host: String) -> Int {
        upstreamRequestLimiter.waitingCount(host: host.lowercased())
    }

    func close() {
        let jobs = lock.withLock { () -> [ActiveJob]? in
            guard acceptingRequests else { return nil }
            acceptingRequests = false
            let jobs = Array(active.values)
            for jobID in active.keys { recordCompletion(jobID) }
            active.removeAll()
            return jobs
        }
        guard let jobs else { return }
        for job in jobs { job.cancel() }
        upstreamRequestLimiter.close()
        directTransport.close()
        systemSession.invalidateAndCancel()
    }

    private func register(jobID: String) throws -> ActiveJob {
        let result = lock.withLock { () -> RegistrationResult in
            guard acceptingRequests else { return .closed }
            guard active[jobID] == nil else { return .duplicate }
            let job = ActiveJob()
            active[jobID] = job
            return .accepted(job)
        }
        switch result {
        case .accepted(let job): return job
        case .duplicate: throw TransportProtocolError.duplicateJob
        case .closed: throw CancellationError()
        }
    }

    private func cancelSync(jobID: String) -> CancelState {
        let result = lock.withLock { () -> (ActiveJob?, CancelState) in
            if let job = active.removeValue(forKey: jobID) {
                recordCompletion(jobID)
                return (job, .cancelled)
            }
            return (nil, completed.contains(jobID) ? .alreadyCompleted : .unknown)
        }
        result.0?.cancel()
        return result.1
    }

    private func finish(jobID: String) -> Bool {
        lock.withLock {
            guard active.removeValue(forKey: jobID) != nil else { return false }
            recordCompletion(jobID)
            return true
        }
    }

    private func recordCompletion(_ jobID: String) {
        completed.insert(jobID)
        if completed.count > 1_024 {
            completed.removeAll(keepingCapacity: true)
            completed.insert(jobID)
        }
    }
}
