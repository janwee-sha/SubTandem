import Darwin
import Foundation

enum FileRPCClientError: Error {
    case invalidRequest
    case requestTooLarge
    case responseTooLarge
    case unavailable
}

struct FileRPCRequestFrame: Sendable {
    let port: UInt16
    let token: String
    let path: String
    let body: Data
}

struct FileRPCNetworkResponse: Sendable {
    let statusCode: Int
    let body: Data
}

enum FileRPCClient {
    static let maximumRequestFileBytes = ProtocolLimits.maxRequestBytes
    static let maximumResponseFileBytes = 65_536
    static let allowedPaths = Set([
        "/v1/health",
        "/v1/prepare",
        "/v1/cancel",
        "/v1/release",
        "/v1/shutdown",
    ])

    static func prepareDirectory(_ directory: URL) throws {
        guard directory.isFileURL, directory.path.hasPrefix("/")
        else { throw FileRPCClientError.invalidRequest }
        try FileManager.default.createDirectory(
            at: directory,
            withIntermediateDirectories: true,
            attributes: [.posixPermissions: 0o700]
        )
        try FileManager.default.setAttributes(
            [.posixPermissions: 0o700],
            ofItemAtPath: directory.path
        )
    }

    static func run(arguments: [String]) async throws {
        guard arguments.count == 8,
              arguments[1] == "--rpc-client",
              arguments[2] == "--rpc-directory",
              arguments[4] == "--request-file",
              arguments[6] == "--response-file",
              getppid() != 1
        else { throw FileRPCClientError.invalidRequest }
        let directory = URL(fileURLWithPath: arguments[3], isDirectory: true).standardizedFileURL
        let requestFile = URL(fileURLWithPath: arguments[5]).standardizedFileURL
        let responseFile = URL(fileURLWithPath: arguments[7]).standardizedFileURL
        try prepareDirectory(directory)
        try validatePaths(directory: directory, requestFile: requestFile, responseFile: responseFile)
        defer { unlink(requestFile.path) }
        let request = try decodeRequest(
            try readPrivateFile(requestFile, maximumBytes: maximumRequestFileBytes)
        )
        let response = try await send(request)
        try writeResponse(response, to: responseFile)
    }

    static func decodeRequest(_ data: Data, nowMs: Int64 = Int64(Date().timeIntervalSince1970 * 1_000)) throws -> FileRPCRequestFrame {
        guard data.count <= maximumRequestFileBytes,
              let json = try JSONSerialization.jsonObject(with: data) as? [String: Any],
              Set(json.keys) == Set(["type", "protocolVersion", "createdAtMs", "port", "token", "path", "body"]),
              json["type"] as? String == "request",
              json["protocolVersion"] as? Int == 1,
              let createdAtMs = (json["createdAtMs"] as? NSNumber)?.int64Value,
              createdAtMs >= nowMs - 30_000,
              createdAtMs <= nowMs + 1_000,
              let portValue = (json["port"] as? NSNumber)?.intValue,
              (1_024...65_535).contains(portValue),
              let port = UInt16(exactly: portValue),
              let token = json["token"] as? String,
              (8...512).contains(token.count),
              token.range(of: "^[A-Za-z0-9_-]+$", options: .regularExpression) != nil,
              let path = json["path"] as? String,
              allowedPaths.contains(path),
              let body = json["body"] as? [String: Any]
        else { throw FileRPCClientError.invalidRequest }
        let bodyData = try JSONSerialization.data(withJSONObject: body, options: [.sortedKeys])
        guard bodyData.count <= ProtocolLimits.maxRequestBytes
        else { throw FileRPCClientError.requestTooLarge }
        return FileRPCRequestFrame(port: port, token: token, path: path, body: bodyData)
    }

    private static func validatePaths(directory: URL, requestFile: URL, responseFile: URL) throws {
        guard requestFile.deletingLastPathComponent().path == directory.path,
              responseFile.deletingLastPathComponent().path == directory.path,
              requestFile.lastPathComponent.hasPrefix("extractor-"),
              requestFile.lastPathComponent.hasSuffix(".request.json")
        else { throw FileRPCClientError.invalidRequest }
        let stem = String(requestFile.lastPathComponent.dropLast(".request.json".count))
        guard responseFile.lastPathComponent == "\(stem).response.json",
              !FileManager.default.fileExists(atPath: responseFile.path)
        else { throw FileRPCClientError.invalidRequest }
    }

    private static func readPrivateFile(_ file: URL, maximumBytes: Int) throws -> Data {
        let descriptor = open(file.path, O_RDWR | O_NOFOLLOW)
        guard descriptor >= 0 else { throw FileRPCClientError.invalidRequest }
        defer { close(descriptor) }
        var metadata = stat()
        guard fstat(descriptor, &metadata) == 0,
              metadata.st_uid == geteuid(),
              metadata.st_mode & S_IFMT == S_IFREG,
              fchmod(descriptor, S_IRUSR | S_IWUSR) == 0
        else { throw FileRPCClientError.invalidRequest }
        var data = Data()
        var buffer = [UInt8](repeating: 0, count: 8_192)
        while true {
            let count = Darwin.read(descriptor, &buffer, buffer.count)
            if count < 0 && errno == EINTR { continue }
            guard count >= 0 else { throw FileRPCClientError.invalidRequest }
            if count == 0 { break }
            data.append(contentsOf: buffer.prefix(count))
            guard data.count <= maximumBytes else { throw FileRPCClientError.requestTooLarge }
        }
        return data
    }

    private static func send(_ request: FileRPCRequestFrame) async throws -> FileRPCNetworkResponse {
        let parentPID = getppid()
        return try await withThrowingTaskGroup(of: FileRPCNetworkResponse.self) { group in
            group.addTask { try await perform(request) }
            group.addTask {
                while kill(parentPID, 0) == 0 || errno == EPERM {
                    try await Task.sleep(nanoseconds: 250_000_000)
                }
                throw FileRPCClientError.unavailable
            }
            defer { group.cancelAll() }
            guard let response = try await group.next()
            else { throw FileRPCClientError.unavailable }
            return response
        }
    }

    private static func perform(_ request: FileRPCRequestFrame) async throws -> FileRPCNetworkResponse {
        guard let url = URL(string: "http://127.0.0.1:\(request.port)\(request.path)")
        else { throw FileRPCClientError.invalidRequest }
        let configuration = URLSessionConfiguration.ephemeral
        configuration.connectionProxyDictionary = [:]
        configuration.timeoutIntervalForRequest = 20
        configuration.timeoutIntervalForResource = 20
        let session = URLSession(configuration: configuration)
        defer { session.invalidateAndCancel() }
        var urlRequest = URLRequest(url: url)
        urlRequest.httpMethod = "POST"
        urlRequest.httpBody = request.body
        urlRequest.setValue("application/json", forHTTPHeaderField: "Content-Type")
        urlRequest.setValue("Bearer \(request.token)", forHTTPHeaderField: "Authorization")
        let (data, response) = try await session.data(for: urlRequest)
        guard data.count <= maximumResponseFileBytes,
              let http = response as? HTTPURLResponse,
              (100...599).contains(http.statusCode),
              (try JSONSerialization.jsonObject(with: data)) is [String: Any]
        else { throw FileRPCClientError.unavailable }
        return FileRPCNetworkResponse(statusCode: http.statusCode, body: data)
    }

    private static func writeResponse(_ response: FileRPCNetworkResponse, to destination: URL) throws {
        guard let body = try JSONSerialization.jsonObject(with: response.body) as? [String: Any]
        else { throw FileRPCClientError.unavailable }
        let object: [String: Any] = [
            "type": "response",
            "protocolVersion": 1,
            "createdAtMs": Int64(Date().timeIntervalSince1970 * 1_000),
            "statusCode": response.statusCode,
            "body": body,
        ]
        let data = try JSONSerialization.data(withJSONObject: object, options: [.sortedKeys])
        guard data.count <= maximumResponseFileBytes
        else { throw FileRPCClientError.responseTooLarge }
        let temporary = destination.deletingLastPathComponent()
            .appendingPathComponent(".\(UUID().uuidString).tmp")
        var descriptor = open(temporary.path, O_WRONLY | O_CREAT | O_EXCL, S_IRUSR | S_IWUSR)
        guard descriptor >= 0 else { throw FileRPCClientError.unavailable }
        defer {
            if descriptor >= 0 { close(descriptor) }
            unlink(temporary.path)
        }
        try data.withUnsafeBytes { bytes in
            guard let baseAddress = bytes.baseAddress else { return }
            var offset = 0
            while offset < data.count {
                let count = Darwin.write(descriptor, baseAddress.advanced(by: offset), data.count - offset)
                if count < 0 && errno == EINTR { continue }
                guard count > 0 else { throw FileRPCClientError.unavailable }
                offset += count
            }
        }
        guard fsync(descriptor) == 0 else { throw FileRPCClientError.unavailable }
        let closeResult = close(descriptor)
        descriptor = -1
        guard closeResult == 0, link(temporary.path, destination.path) == 0
        else { throw FileRPCClientError.unavailable }
    }
}
