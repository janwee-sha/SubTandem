import Darwin
import Foundation

enum FileRPCWorkerError: Error {
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

private struct ClaimedFileRPCRequest: Sendable {
    let processingFile: URL
    let responseFile: URL
}

enum FileRPCWorker {
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
        else { throw FileRPCWorkerError.invalidRequest }
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

    static func run(
        directory: URL,
        port: UInt16,
        maximumConcurrentRequests: Int = 4,
        handle: @escaping @Sendable (String, String, Data) async -> ProtocolResponse
    ) async {
        await withTaskGroup(of: Void.self) { group in
            var activeRequests = 0
            while !Task.isCancelled {
                if activeRequests >= maximumConcurrentRequests {
                    _ = await group.next()
                    activeRequests -= 1
                    continue
                }
                let claims = claimRequests(
                    directory: directory,
                    limit: maximumConcurrentRequests - activeRequests
                )
                for claim in claims {
                    activeRequests += 1
                    group.addTask {
                        await process(claim, expectedPort: port, handle: handle)
                    }
                }
                if claims.isEmpty {
                    do {
                        try await Task.sleep(nanoseconds: 20_000_000)
                    } catch {
                        break
                    }
                }
            }
            group.cancelAll()
            await group.waitForAll()
        }
    }

    static func decodeRequest(
        _ data: Data,
        nowMs: Int64 = Int64(Date().timeIntervalSince1970 * 1_000)
    ) throws -> FileRPCRequestFrame {
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
        else { throw FileRPCWorkerError.invalidRequest }
        let bodyData = try JSONSerialization.data(withJSONObject: body, options: [.sortedKeys])
        guard bodyData.count <= ProtocolLimits.maxRequestBytes
        else { throw FileRPCWorkerError.requestTooLarge }
        return FileRPCRequestFrame(port: port, token: token, path: path, body: bodyData)
    }

    private static func claimRequests(directory: URL, limit: Int) -> [ClaimedFileRPCRequest] {
        guard limit > 0,
              let entries = try? FileManager.default.contentsOfDirectory(
                  at: directory,
                  includingPropertiesForKeys: nil,
                  options: [.skipsHiddenFiles]
              )
        else { return [] }
        var claims: [ClaimedFileRPCRequest] = []
        for marker in entries.sorted(by: { $0.lastPathComponent < $1.lastPathComponent }) {
            guard claims.count < limit,
                  let stem = requestStem(marker.lastPathComponent)
            else {
                if claims.count >= limit { break }
                continue
            }
            let requestFile = directory.appendingPathComponent("\(stem).request.json")
            let processingFile = directory.appendingPathComponent("\(stem).processing.json")
            let responseFile = directory.appendingPathComponent("\(stem).response.json")
            guard !FileManager.default.fileExists(atPath: processingFile.path),
                  !FileManager.default.fileExists(atPath: responseFile.path)
            else {
                unlink(marker.path)
                continue
            }
            if rename(requestFile.path, processingFile.path) == 0 {
                unlink(marker.path)
                claims.append(
                    ClaimedFileRPCRequest(
                        processingFile: processingFile,
                        responseFile: responseFile
                    )
                )
            } else if errno == ENOENT {
                unlink(marker.path)
            }
        }
        return claims
    }

    private static func requestStem(_ filename: String) -> String? {
        let suffix = ".request.ready"
        guard filename.hasPrefix("extractor-"), filename.hasSuffix(suffix) else { return nil }
        let stem = String(filename.dropLast(suffix.count))
        let parts = stem.split(separator: "-", omittingEmptySubsequences: false)
        guard parts.count == 4,
              parts[0] == "extractor",
              parts.dropFirst().allSatisfy({
                  !$0.isEmpty && $0.allSatisfy { $0.isASCII && ($0.isNumber || $0.isLowercase) }
              })
        else { return nil }
        return stem
    }

    private static func process(
        _ claim: ClaimedFileRPCRequest,
        expectedPort: UInt16,
        handle: @escaping @Sendable (String, String, Data) async -> ProtocolResponse
    ) async {
        defer { unlink(claim.processingFile.path) }
        do {
            let request = try decodeRequest(
                try readPrivateFile(
                    claim.processingFile,
                    maximumBytes: maximumRequestFileBytes
                )
            )
            guard request.port == expectedPort else { throw FileRPCWorkerError.invalidRequest }
            let response = await handle(request.path, request.token, request.body)
            try writeResponse(response, to: claim.responseFile)
        } catch {
            return
        }
    }

    private static func readPrivateFile(_ file: URL, maximumBytes: Int) throws -> Data {
        let descriptor = open(file.path, O_RDWR | O_NOFOLLOW)
        guard descriptor >= 0 else { throw FileRPCWorkerError.invalidRequest }
        defer { close(descriptor) }
        var metadata = stat()
        guard fstat(descriptor, &metadata) == 0,
              metadata.st_uid == geteuid(),
              metadata.st_mode & S_IFMT == S_IFREG,
              fchmod(descriptor, S_IRUSR | S_IWUSR) == 0
        else { throw FileRPCWorkerError.invalidRequest }
        var data = Data()
        var buffer = [UInt8](repeating: 0, count: 8_192)
        while true {
            let count = Darwin.read(descriptor, &buffer, buffer.count)
            if count < 0 && errno == EINTR { continue }
            guard count >= 0 else { throw FileRPCWorkerError.invalidRequest }
            if count == 0 { break }
            data.append(contentsOf: buffer.prefix(count))
            guard data.count <= maximumBytes else { throw FileRPCWorkerError.requestTooLarge }
        }
        return data
    }

    private static func writeResponse(_ response: ProtocolResponse, to destination: URL) throws {
        guard let body = try JSONSerialization.jsonObject(with: response.body) as? [String: Any]
        else { throw FileRPCWorkerError.unavailable }
        let object: [String: Any] = [
            "type": "response",
            "protocolVersion": 1,
            "createdAtMs": Int64(Date().timeIntervalSince1970 * 1_000),
            "statusCode": response.statusCode,
            "body": body,
        ]
        let data = try JSONSerialization.data(withJSONObject: object, options: [.sortedKeys])
        guard data.count <= maximumResponseFileBytes
        else { throw FileRPCWorkerError.responseTooLarge }
        let temporary = destination.deletingLastPathComponent()
            .appendingPathComponent(".\(UUID().uuidString).tmp")
        var descriptor = open(temporary.path, O_WRONLY | O_CREAT | O_EXCL, S_IRUSR | S_IWUSR)
        guard descriptor >= 0 else { throw FileRPCWorkerError.unavailable }
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
                guard count > 0 else { throw FileRPCWorkerError.unavailable }
                offset += count
            }
        }
        guard fsync(descriptor) == 0 else { throw FileRPCWorkerError.unavailable }
        let closeResult = close(descriptor)
        descriptor = -1
        guard closeResult == 0, link(temporary.path, destination.path) == 0
        else { throw FileRPCWorkerError.unavailable }
    }
}
