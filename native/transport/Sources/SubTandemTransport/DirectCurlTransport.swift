import CCurl
import Foundation

final class CurlRequestContext: @unchecked Sendable {
    private let lock = NSLock()
    private(set) var body = Data()
    private(set) var headers: [String: String] = [:]
    private(set) var responseTooLarge = false
    private var cancelled = false
    let maximumResponseBytes: Int

    init(maximumResponseBytes: Int) {
        self.maximumResponseBytes = maximumResponseBytes
    }

    func cancel() { lock.withLock { cancelled = true } }
    func isCancelled() -> Bool { lock.withLock { cancelled } }

    func appendBody(_ bytes: UnsafeRawPointer, count: Int) -> Int {
        lock.withLock {
            guard body.count + count <= maximumResponseBytes else {
                responseTooLarge = true
                return 0
            }
            body.append(bytes.assumingMemoryBound(to: UInt8.self), count: count)
            return count
        }
    }

    func consumeHeader(_ bytes: UnsafeRawPointer, count: Int) -> Int {
        let data = Data(bytes: bytes, count: count)
        guard let line = String(data: data, encoding: .utf8) else { return count }
        let trimmed = line.trimmingCharacters(in: .whitespacesAndNewlines)
        if trimmed.hasPrefix("HTTP/") {
            lock.withLock { headers.removeAll(keepingCapacity: true) }
            return count
        }
        guard let separator = trimmed.firstIndex(of: ":") else { return count }
        let name = trimmed[..<separator].lowercased()
        guard ["retry-after", "x-request-id", "content-type"].contains(name) else { return count }
        let value = trimmed[trimmed.index(after: separator)...].trimmingCharacters(in: .whitespaces)
        guard value.count <= 1_024, !value.contains("\n"), !value.contains("\r") else { return count }
        lock.withLock { headers[String(name)] = value }
        return count
    }
}

private let curlWriteCallback: @convention(c) (
    UnsafeMutablePointer<CChar>?, Int, Int, UnsafeMutableRawPointer?
) -> Int = { pointer, size, count, contextPointer in
    guard let pointer, let contextPointer else { return 0 }
    let byteCount = size * count
    return Unmanaged<CurlRequestContext>.fromOpaque(contextPointer)
        .takeUnretainedValue().appendBody(pointer, count: byteCount)
}

private let curlHeaderCallback: @convention(c) (
    UnsafeMutablePointer<CChar>?, Int, Int, UnsafeMutableRawPointer?
) -> Int = { pointer, size, count, contextPointer in
    guard let pointer, let contextPointer else { return 0 }
    let byteCount = size * count
    return Unmanaged<CurlRequestContext>.fromOpaque(contextPointer)
        .takeUnretainedValue().consumeHeader(pointer, count: byteCount)
}

private let curlProgressCallback: @convention(c) (
    UnsafeMutableRawPointer?, Int, Int, Int, Int
) -> Int32 = { contextPointer, _, _, _, _ in
    guard let contextPointer else { return 1 }
    return Unmanaged<CurlRequestContext>.fromOpaque(contextPointer)
        .takeUnretainedValue().isCancelled() ? 1 : 0
}

final class DirectCurlTransport: @unchecked Sendable {
    private static let initialized: Bool = curl_global_init(Int(CURL_GLOBAL_DEFAULT)) == CURLE_OK
    private static let maximumIdleHandles = 4
    private let executionQueue = DispatchQueue(
        label: "io.subtandem.transport.direct",
        attributes: .concurrent
    )
    private let lock = NSLock()
    private var handles: [UnsafeMutableRawPointer] = []
    private var closed = false

    func perform(
        _ request: TransportRequest,
        context: CurlRequestContext
    ) async throws -> TransportResponse {
        try Task.checkCancellation()
        return try await withTaskCancellationHandler {
            try await withCheckedThrowingContinuation { continuation in
                executionQueue.async {
                    let result: Result<TransportResponse, Error> = Result {
                        guard !context.isCancelled() else { throw CancellationError() }
                        return try self.performBlocking(request, context: context)
                    }
                    continuation.resume(with: result)
                }
            }
        } onCancel: {
            context.cancel()
        }
    }

    private func performBlocking(
        _ request: TransportRequest,
        context: CurlRequestContext
    ) throws -> TransportResponse {
        guard Self.initialized, let handle = acquireHandle() else {
            throw TransportProtocolError.upstreamNetwork
        }
        defer { releaseHandle(handle) }
        curl_easy_reset(handle)

        let contextPointer = Unmanaged.passUnretained(context).toOpaque()
        try Self.setString(handle, CURLOPT_URL, request.url)
        try Self.setString(handle, CURLOPT_NOPROXY, "*")
        try Self.setLong(handle, CURLOPT_NOSIGNAL, 1)
        try Self.setLong(handle, CURLOPT_NOPROGRESS, 0)
        try Self.setLong(handle, CURLOPT_FOLLOWLOCATION, 0)
        try Self.setLong(handle, CURLOPT_FAILONERROR, 0)
        try Self.setLong(handle, CURLOPT_MAXCONNECTS, 1)
        try Self.setLong(handle, CURLOPT_TIMEOUT_MS, request.timeoutMilliseconds)
        try Self.setLong(handle, CURLOPT_CONNECTTIMEOUT_MS, request.timeoutMilliseconds)
        guard sl_curl_setopt_write_callback(handle, curlWriteCallback) == CURLE_OK,
              sl_curl_setopt_header_callback(handle, curlHeaderCallback) == CURLE_OK,
              sl_curl_setopt_progress_callback(handle, curlProgressCallback) == CURLE_OK,
              sl_curl_setopt_pointer(handle, CURLOPT_WRITEDATA, contextPointer) == CURLE_OK,
              sl_curl_setopt_pointer(handle, CURLOPT_HEADERDATA, contextPointer) == CURLE_OK,
              sl_curl_setopt_pointer(handle, CURLOPT_XFERINFODATA, contextPointer) == CURLE_OK
        else { throw TransportProtocolError.upstreamNetwork }

        var headerList: UnsafeMutablePointer<curl_slist>?
        for (name, value) in request.headers where name.caseInsensitiveCompare("Connection") != .orderedSame {
            headerList = curl_slist_append(headerList, "\(name): \(value)")
        }
        headerList = curl_slist_append(headerList, "Expect:")
        defer { curl_slist_free_all(headerList) }
        guard sl_curl_setopt_headers(handle, headerList) == CURLE_OK else {
            throw TransportProtocolError.upstreamNetwork
        }

        let result: CURLcode
        if request.method == "POST" {
            try Self.setLong(handle, CURLOPT_POST, 1)
            try Self.setOffset(handle, CURLOPT_POSTFIELDSIZE_LARGE, request.body.count)
            result = request.body.withUnsafeBytes { bytes in
                guard sl_curl_setopt_pointer(
                    handle,
                    CURLOPT_POSTFIELDS,
                    UnsafeMutableRawPointer(mutating: bytes.baseAddress)
                ) == CURLE_OK else { return CURLE_FAILED_INIT }
                return curl_easy_perform(handle)
            }
        } else {
            try Self.setLong(handle, CURLOPT_HTTPGET, 1)
            result = curl_easy_perform(handle)
        }

        if result != CURLE_OK {
            if context.responseTooLarge { throw TransportProtocolError.responseTooLarge }
            if context.isCancelled() { throw CancellationError() }
            if result == CURLE_OPERATION_TIMEDOUT { throw TransportProtocolError.timedOut }
            throw TransportProtocolError.upstreamNetwork
        }
        var statusCode: Int = 0
        guard sl_curl_get_response_code(handle, &statusCode) == CURLE_OK else {
            throw TransportProtocolError.upstreamNetwork
        }
        return TransportResponse(
            jobID: request.jobID,
            transportState: "completed",
            statusCode: statusCode,
            headers: context.headers,
            body: context.body
        )
    }

    func close() {
        let idleHandles: [UnsafeMutableRawPointer] = lock.withLock {
            guard !closed else { return [] }
            closed = true
            let idleHandles = handles
            self.handles.removeAll()
            return idleHandles
        }
        for handle in idleHandles { curl_easy_cleanup(handle) }
    }

    deinit { close() }

    private func acquireHandle() -> UnsafeMutableRawPointer? {
        lock.withLock {
            guard !closed else { return nil }
            return handles.popLast() ?? curl_easy_init()
        }
    }

    private func releaseHandle(_ handle: UnsafeMutableRawPointer) {
        let shouldClean = lock.withLock {
            guard !closed, handles.count < Self.maximumIdleHandles else { return true }
            handles.append(handle)
            return false
        }
        if shouldClean { curl_easy_cleanup(handle) }
    }

    private static func setLong(
        _ handle: UnsafeMutableRawPointer,
        _ option: CURLoption,
        _ value: Int
    ) throws {
        guard sl_curl_setopt_long(handle, option, value) == CURLE_OK else {
            throw TransportProtocolError.upstreamNetwork
        }
    }

    private static func setOffset(
        _ handle: UnsafeMutableRawPointer,
        _ option: CURLoption,
        _ value: Int
    ) throws {
        guard sl_curl_setopt_offset(handle, option, value) == CURLE_OK else {
            throw TransportProtocolError.upstreamNetwork
        }
    }

    private static func setString(
        _ handle: UnsafeMutableRawPointer,
        _ option: CURLoption,
        _ value: String
    ) throws {
        guard sl_curl_setopt_string(handle, option, value) == CURLE_OK else {
            throw TransportProtocolError.upstreamNetwork
        }
    }
}
