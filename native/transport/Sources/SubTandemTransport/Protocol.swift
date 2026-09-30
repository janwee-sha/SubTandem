import Darwin
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
    let createdAtMs: Int64

    init(
        port: UInt16,
        token: String,
        createdAtMs: Int64 = Int64(Date().timeIntervalSince1970 * 1_000)
    ) {
        self.type = "ready"
        self.port = port
        self.token = token
        self.protocolVersion = 2
        self.createdAtMs = createdAtMs
    }

    func encodedLine() throws -> String {
        var data = try JSONEncoder().encode(self)
        data.append(0x0A)
        return String(decoding: data, as: UTF8.self)
    }
}

enum ReadyFileWriter {
    static func write(_ frame: ReadyFrame, to destination: URL) throws {
        guard destination.isFileURL, destination.path.hasPrefix("/")
        else { throw TransportProtocolError.invalidRequest }
        let directory = destination.deletingLastPathComponent()
        try FileManager.default.createDirectory(
            at: directory,
            withIntermediateDirectories: true,
            attributes: [.posixPermissions: 0o700]
        )
        try FileManager.default.setAttributes(
            [.posixPermissions: 0o700],
            ofItemAtPath: directory.path
        )
        let temporary = directory.appendingPathComponent(".\(UUID().uuidString).tmp")
        var descriptor = open(temporary.path, O_WRONLY | O_CREAT | O_EXCL, S_IRUSR | S_IWUSR)
        guard descriptor >= 0 else { throw TransportProtocolError.invalidRequest }
        defer {
            if descriptor >= 0 { close(descriptor) }
            unlink(temporary.path)
        }
        let data = Data(try frame.encodedLine().utf8)
        try data.withUnsafeBytes { bytes in
            guard let baseAddress = bytes.baseAddress else { return }
            var offset = 0
            while offset < data.count {
                let count = Darwin.write(descriptor, baseAddress.advanced(by: offset), data.count - offset)
                if count < 0 && errno == EINTR { continue }
                guard count > 0 else { throw TransportProtocolError.invalidRequest }
                offset += count
            }
        }
        guard fsync(descriptor) == 0 else { throw TransportProtocolError.invalidRequest }
        let closeResult = close(descriptor)
        descriptor = -1
        guard closeResult == 0,
              link(temporary.path, destination.path) == 0
        else { throw TransportProtocolError.invalidRequest }
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
    case invalidProfileState
    case profileStateConflict
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
    var restrictRedirects = false

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
    var rawHeaders: [String] = []
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
    private let credentialChannels = CredentialChannelManager()
    private let httpClient: HTTPClient
    private let credentialStore: CredentialStoreAccess
    private let shutdown: @Sendable () -> Void
    private var preparingJobs: [String: UUID] = [:]
    private var acceptingRequests = true

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
        case "/v2/health":
            let isEmptyObjectBody = body.isEmpty || body == Data("{}".utf8)
            guard isEmptyObjectBody else {
                return .json(statusCode: 400, ["error": "invalid-request"])
            }
            #if SUBTANDEM_CREDENTIAL_HOST_PROBE
            return .json(statusCode: 200, ["state": "ok", "protocolVersion": 2, "probeBuildId": CredentialHostProbeBuild.id])
            #else
            return .json(statusCode: 200, ["state": "ok", "protocolVersion": 2])
            #endif

        case "/v2/credential-channel":
            return await handleCredentialChannel(body)

        case "/v2/profile-state":
            guard let json = try? JSONSerialization.jsonObject(with: body) as? [String: Any],
                  let action = json["action"] as? String
            else { return .json(statusCode: 400, ["error": "invalid-profile-state"]) }
            do {
                switch action {
                case "save" where json.count == 3:
                    return try await saveProfile(json)
                case "read" where json.count == 1:
                    return Self.storeResponse(try await credentialStore.readProfileState())
                case "open" where json.count == 2:
                    guard let commitID = json["commitId"] as? String else {
                        return .json(statusCode: 400, ["error": "invalid-profile-state"])
                    }
                    return Self.storeResponse(
                        try await credentialStore.openProfileState(commitID: commitID),
                        state: "committed"
                    )
                case "initialize" where json.count == 4:
                    guard let commitID = json["commitId"] as? String,
                          let expected = json["expectedStoreRevision"] as? Int,
                          let profiles = try Self.decodeProfiles(json["profiles"])
                    else { return .json(statusCode: 400, ["error": "invalid-profile-state"]) }
                    return Self.storeResponse(
                        try await credentialStore.initializeProfileState(
                            commitID: commitID,
                            expectedStoreRevision: expected,
                            profiles: profiles
                        ),
                        state: "committed"
                    )
                case "commit" where json.count == 4:
                    guard let commitID = json["commitId"] as? String,
                          let expected = json["expectedStoreRevision"] as? Int,
                          let profileState = try Self.decodeProfileState(json["profileState"])
                    else { return .json(statusCode: 400, ["error": "invalid-profile-state"]) }
                    return Self.storeResponse(
                        try await credentialStore.commitProfileState(
                            commitID: commitID,
                            expectedStoreRevision: expected,
                            profileState: profileState
                        ),
                        state: "committed"
                    )
                default:
                    return .json(statusCode: 400, ["error": "invalid-profile-state"])
                }
            } catch CredentialStoreFailure.unconfirmed {
                return .json(statusCode: 503, ["error": "profile-state-unconfirmed"])
            } catch let error as CredentialFailure {
                return .json(statusCode: 400, ["error": error.rawValue])
            } catch TransportProtocolError.profileStateConflict {
                return .json(statusCode: 409, ["error": "profile-state-conflict"])
            } catch TransportProtocolError.invalidRequest,
                    TransportProtocolError.invalidProfileState {
                return .json(statusCode: 400, ["error": "invalid-profile-state"])
            } catch {
                return .json(statusCode: 503, ["error": "credential-store-unavailable"])
            }

        case "/v2/cancel":
            guard let json = try? JSONSerialization.jsonObject(with: body) as? [String: Any],
                  let jobID = json["jobId"] as? String
            else { return .json(statusCode: 400, ["error": "invalid-cancel-request"]) }
            preparingJobs.removeValue(forKey: jobID)
            let state = await httpClient.cancel(jobID: jobID)
            return .json(statusCode: 200, ["state": state.rawValue])

        case "/v2/shutdown":
            acceptingRequests = false
            preparingJobs.removeAll()
            await credentialChannels.closeAll()
            httpClient.close()
            shutdown()
            return .json(statusCode: 200, ["state": "shutting-down"])

        case "/v2/request":
            do {
                let input = try CredentialHTTPRequest(body)
                guard acceptingRequests else { throw CancellationError() }
                guard preparingJobs[input.request.jobID] == nil else { throw TransportProtocolError.duplicateJob }
                let generation = UUID()
                preparingJobs[input.request.jobID] = generation
                defer { if preparingJobs[input.request.jobID] == generation { preparingJobs.removeValue(forKey: input.request.jobID) } }
                try await authorize(input, generation: generation)
                var value = Data()
                if case .saved(let reference) = input.credential {
                    value = try await credentialStore.readCredential(profileID: reference.profile.profileID, expectedProfileRevision: Int(reference.profile.profileRevision)) ?? Data()
                }
                defer { value.resetBytes(in: 0..<value.count) }
                var headers = input.request.headers
                if !value.isEmpty {
                    guard let key = String(data: value, encoding: .utf8), !key.contains("\r"), !key.contains("\n"), !key.contains("\0") else { throw CredentialFailure.unavailable }
                    if input.kind == "claude" { headers["x-api-key"] = key }
                    else { headers["Authorization"] = "Bearer " + key }
                }
                let request = TransportRequest(jobID: input.request.jobID, method: input.request.method, url: input.request.url, headers: headers, proxyMode: input.request.proxyMode, body: input.request.body, timeoutMilliseconds: input.request.timeoutMilliseconds, maxResponseBytes: input.request.maxResponseBytes, restrictRedirects: true)
                let result = try await httpClient.perform(request, authorize: { try await self.authorize(input, generation: generation) })
                try await authorize(input, generation: generation)
                try CredentialResponseGuard.validate(body: result.body, headers: result.rawHeaders, credential: value)
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
        case let failure as CredentialFailure:
            return .json(statusCode: 400, ["error": failure.rawValue])
        case TransportProtocolError.profileStateConflict:
            return .json(statusCode: 409, ["error": "profile-state-conflict"])
        case TransportProtocolError.credentialStoreUnavailable:
            return .json(statusCode: 503, ["error": "credential-store-unavailable"])
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

    private func authorize(_ input: CredentialHTTPRequest, generation: UUID) async throws {
        guard acceptingRequests, preparingJobs[input.request.jobID] == generation else { throw CancellationError() }
        if case .saved(let reference) = input.credential {
            let snapshot = try await credentialStore.readProfileState()
            guard let profile = snapshot.profileState?.profiles.first(where: { $0.profileId == reference.profile.profileID }),
                  profile.revision == reference.profile.profileRevision, profile.kind == reference.kind,
                  profile.endpointFingerprint == reference.profile.endpointFingerprint,
                  profile.kind == input.kind, profile.endpoint == input.endpoint,
                  profile.proxyMode == input.request.proxyMode,
                  input.purpose == "models" && input.model == nil || profile.model == input.model
            else { throw CredentialFailure.ownerMismatch }
            if input.purpose == "translation" {
                guard let activation = snapshot.profileState?.activation,
                      activation.profileId == profile.profileId, activation.profileRevision == profile.revision,
                      activation.kind == profile.kind, activation.endpointFingerprint == profile.endpointFingerprint,
                      activation.credentialConfigured == snapshot.credentialConfigured[profile.profileId]
                else { throw CredentialFailure.ownerMismatch }
            }
        } else if input.purpose == "translation" { throw CredentialFailure.ownerMismatch }
        guard acceptingRequests, preparingJobs[input.request.jobID] == generation else { throw CancellationError() }
    }

    private nonisolated static func storeResponse(
        _ snapshot: ProfileStoreSnapshot,
        state: String? = nil
    ) -> ProtocolResponse {
        guard let data = try? JSONEncoder().encode(snapshot),
              var object = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
        else { return .json(statusCode: 503, ["error": "credential-store-unavailable"]) }
        if snapshot.lastCommit == nil { object["lastCommit"] = NSNull() }
        if snapshot.profileState == nil {
            object["profileState"] = NSNull()
        } else if snapshot.profileState?.activation == nil,
                  var profileState = object["profileState"] as? [String: Any]
        {
            profileState["activation"] = NSNull()
            object["profileState"] = profileState
        }
        if let state { object["state"] = state }
        return .json(statusCode: 200, object)
    }

    private func saveProfile(_ json: [String: Any]) async throws -> ProtocolResponse {
        let ownerRecord = try CredentialWire.record(json["owner"] as Any, keys: ["senderId", "sidebarInstanceId", "drawerId"])
        let owner = CredentialChannelOwner(sidebarInstanceID: try CredentialWire.identity(ownerRecord["sidebarInstanceId"]), senderID: try CredentialWire.identity(ownerRecord["senderId"]), drawerID: try CredentialWire.identity(ownerRecord["drawerId"]))
        let frame = try CredentialSealedOperation(json["frame"] as Any)
        try CredentialChannelManager.validateSnapshot(frame)
        guard frame.context.purpose == "save-profile",
              let snapshot = try JSONSerialization.jsonObject(with: frame.snapshot) as? [String: Any],
              let metadata = snapshot["save"] as? [String: Any],
              let state = try Self.decodeProfileState(metadata["profileState"])
        else { throw CredentialFailure.invalidMessage }
        let commitID = try CredentialWire.identity(metadata["commitId"])
        let base = Int(try CredentialWire.integer(metadata["expectedStoreRevision"]))
        let sourceRevision = metadata["expectedProfileRevision"] is NSNull ? 0 : Int(try CredentialWire.integer(metadata["expectedProfileRevision"], minimum: 1))
        let digest = CredentialCryptography.digest(try JSONSerialization.data(withJSONObject: ["operation": "save-profile", "owner": ownerRecord, "frame": frame.object], options: [.sortedKeys, .withoutEscapingSlashes]))
        if let confirmed = try await credentialStore.confirmSave(commitID: commitID, expectedStoreRevision: base, requestDigest: digest) { return Self.storeResponse(confirmed, state: "committed") }
        let previous = try await credentialStore.readProfileState()
        guard previous.storeRevision == base, let existing = previous.profileState,
              (frame.context.source?.profileRevision ?? 0) == sourceRevision
        else { throw TransportProtocolError.profileStateConflict }
        let candidates = state.profiles.filter { candidate in
            if let source = frame.context.source { return candidate.profileId == source.profileID }
            return !existing.profiles.contains { $0.profileId == candidate.profileId }
        }
        guard candidates.count == 1, let target = candidates.first,
              target.kind == frame.context.kind, target.endpointFingerprint == frame.context.endpointFingerprint,
              target.endpoint == snapshot["endpoint"] as? String, target.model == snapshot["model"] as? String,
              target.proxyMode == snapshot["proxyMode"] as? String
        else { throw CredentialFailure.invalidMessage }
        let store = credentialStore
        var operation = try await credentialChannels.decrypt(JSONSerialization.data(withJSONObject: frame.object), owner: owner, validateSource: { source in
            guard let source else { return }
            let current = try await store.readProfileState()
            guard let profile = current.profileState?.profiles.first(where: { $0.profileId == source.profileID }), profile.revision == source.profileRevision, profile.endpointFingerprint == source.endpointFingerprint
            else { throw CredentialFailure.ownerMismatch }
        })
        defer { operation.value.resetBytes(in: 0..<operation.value.count) }
        try await credentialChannels.finish(operation)
        let saved = try await credentialStore.saveProfile(CredentialProfileSave(commitID: commitID, expectedStoreRevision: base, expectedProfileRevision: sourceRevision, profileID: target.profileId, profileState: state, requestDigest: digest), value: operation.value)
        await credentialChannels.close(profileID: target.profileId)
        await credentialChannels.close(owner: owner)
        return Self.storeResponse(saved, state: "committed")
    }

    private func handleCredentialChannel(_ body: Data) async -> ProtocolResponse {
        do {
            let input = try CredentialWire.record(JSONSerialization.jsonObject(with: body), keys: ["action", "payload"])
            guard let action = input["action"] as? String, let payload = input["payload"] as? [String: Any]
            else { throw CredentialFailure.invalidMessage }
            let store = credentialStore
            let validateSource: @Sendable (CredentialSource?) async throws -> Void = { source in
                guard let source else { return }
                let snapshot = try await store.readProfileState()
                guard let profile = snapshot.profileState?.profiles.first(where: { $0.profileId == source.profileID }),
                      profile.revision == source.profileRevision, profile.endpointFingerprint == source.endpointFingerprint
                else { throw CredentialFailure.ownerMismatch }
            }
            if action == "open" {
                var opening = try CredentialWire.record(payload, keys: ["protocolVersion", "sidebarInstanceId", "drawerId", "sourceProfile", "clientPublicKey", "senderId"])
                let senderID = try CredentialWire.identity(opening.removeValue(forKey: "senderId"))
                let data = try JSONSerialization.data(withJSONObject: opening)
                let response = try await credentialChannels.open(data, senderID: senderID, validateSource: validateSource)
                return ProtocolResponse(statusCode: 200, body: response)
            }
            let request = try CredentialWire.record(payload, keys: action == "close" ? ["owner"] : ["owner", "frame"])
            let ownerRecord = try CredentialWire.record(request["owner"] as Any, keys: ["senderId", "sidebarInstanceId", "drawerId"])
            let owner = CredentialChannelOwner(sidebarInstanceID: try CredentialWire.identity(ownerRecord["sidebarInstanceId"]), senderID: try CredentialWire.identity(ownerRecord["senderId"]), drawerID: try CredentialWire.identity(ownerRecord["drawerId"]))
            if action == "close" {
                await credentialChannels.close(owner: owner)
                return .json(statusCode: 200, ["state": "closed"])
            }
            let data = try JSONSerialization.data(withJSONObject: request["frame"] as Any)
            if action == "confirm" {
                return ProtocolResponse(statusCode: 200, body: try await credentialChannels.confirm(data, owner: owner))
            }
            if action == "operation" {
                var operation = try await credentialChannels.decrypt(data, owner: owner, validateSource: validateSource)
                defer { operation.value.resetBytes(in: 0..<operation.value.count) }
                #if SUBTANDEM_CREDENTIAL_HOST_PROBE
                let responseValue = try CredentialHostProbe.run(operation)
                return ProtocolResponse(statusCode: 200, body: try await credentialChannels.respond(responseValue, operation: operation))
                #else
                throw CredentialFailure.channelUnavailable
                #endif
            }
            throw CredentialFailure.invalidMessage
        } catch let error as CredentialFailure {
            return .json(statusCode: 400, ["error": error.rawValue])
        } catch {
            return .json(statusCode: 400, ["error": CredentialFailure.channelUnavailable.rawValue])
        }
    }

    private nonisolated static func decodeProfiles(_ value: Any?) throws -> [StoredProviderProfile]? {
        guard let values = value as? [[String: Any]] else { return nil }
        let required = Set([
            "profileId", "revision", "displayName", "kind", "endpoint",
            "endpointFingerprint", "proxyMode", "model",
        ])
        let allowed = required.union(["capability"])
        guard values.allSatisfy({ Set($0.keys).isSubset(of: allowed) && required.isSubset(of: Set($0.keys)) }),
              let data = try? JSONSerialization.data(withJSONObject: values),
              let profiles = try? JSONDecoder().decode([StoredProviderProfile].self, from: data)
        else { return nil }
        return profiles
    }

    private nonisolated static func decodeProfileState(_ value: Any?) throws -> StoredProfileState? {
        guard let object = value as? [String: Any], Set(object.keys) == Set(["profiles", "activation"]),
              let profiles = try decodeProfiles(object["profiles"])
        else { return nil }
        let activation: StoredActivationReference?
        if object["activation"] is NSNull {
            activation = nil
        } else {
            guard let raw = object["activation"] as? [String: Any],
                  Set(raw.keys) == Set([
                    "profileId", "profileRevision", "kind", "endpointFingerprint",
                    "credentialConfigured",
                  ]),
                  let data = try? JSONSerialization.data(withJSONObject: raw),
                  let decoded = try? JSONDecoder().decode(StoredActivationReference.self, from: data)
            else { return nil }
            activation = decoded
        }
        return StoredProfileState(profiles: profiles, activation: activation)
    }
}

enum CredentialWire {
    static let version = 2
    static let keyBytes = 8_192
    static let sealedBytes = 32_768
    static let documentBytes = 1_048_576
    static let mailboxBytes = 2_097_152
    static let idleMilliseconds: Int64 = 300_000
    static let messageLimit = 4_096
    static let receiveWindow = 128
    static let purposes = ["read-edit", "save-profile", "draft-test", "draft-models"]
    static let kinds = ["openai", "claude", "deepseek", "ollama"]

    static func record(_ value: Any, keys: [String]) throws -> [String: Any] {
        guard let object = value as? [String: Any], Set(object.keys) == Set(keys)
        else { throw CredentialFailure.invalidMessage }
        return object
    }

    static func identity(_ value: Any?) throws -> String {
        guard let text = value as? String,
              text.range(of: "^[A-Za-z0-9._:-]{1,128}$", options: .regularExpression) != nil
        else { throw CredentialFailure.invalidMessage }
        return text
    }

    static func integer(_ value: Any?, minimum: Int64 = 0, maximum: Int64 = 9_007_199_254_740_991) throws -> Int64 {
        guard let number = value as? NSNumber,
              CFGetTypeID(number) != CFBooleanGetTypeID(),
              number.doubleValue.isFinite,
              number.doubleValue.rounded() == number.doubleValue,
              number.doubleValue >= Double(minimum), number.doubleValue <= Double(maximum)
        else { throw CredentialFailure.invalidMessage }
        return number.int64Value
    }

    static func base64(_ value: Any?, maximum: Int, exact: Int? = nil) throws -> Data {
        guard let text = value as? String, text.utf8.count <= ((maximum + 2) / 3) * 4,
              let bytes = Data(base64Encoded: text), bytes.count <= maximum,
              exact == nil || bytes.count == exact,
              bytes.base64EncodedString() == text
        else { throw CredentialFailure.invalidMessage }
        return bytes
    }

    static func array(_ values: [Any]) throws -> Data {
        try JSONSerialization.data(withJSONObject: values, options: [.withoutEscapingSlashes])
    }

    static func nonce(_ sequence: Int64) throws -> Data {
        guard sequence >= 0, sequence <= 9_007_199_254_740_991 else { throw CredentialFailure.invalidMessage }
        var bigEndian = UInt64(sequence).bigEndian
        var data = Data(repeating: 0, count: 4)
        withUnsafeBytes(of: &bigEndian) { data.append(contentsOf: $0) }
        return data
    }
}

enum CredentialFailure: String, Error, Sendable {
    case invalidMessage = "invalid-credential-message"
    case channelUnavailable = "credential-channel-unavailable"
    case expired = "credential-channel-expired"
    case authentication = "credential-authentication-failed"
    case replay = "credential-replay"
    case ownerMismatch = "credential-owner-mismatch"
    case hardwareUnavailable = "credential-hardware-unavailable"
    case unavailable = "credential-unavailable"
    case reflection = "credential-reflection"
    case tooLarge = "credential-too-large"
    case protocolMismatch = "credential-protocol-mismatch"
}

struct CredentialSource: Equatable, Sendable {
    let profileID: String
    let profileRevision: Int64
    let endpointFingerprint: String

    init(_ value: Any) throws {
        let object = try CredentialWire.record(value, keys: ["profileId", "profileRevision", "endpointFingerprint"])
        profileID = try CredentialWire.identity(object["profileId"])
        profileRevision = try CredentialWire.integer(object["profileRevision"], minimum: 1)
        endpointFingerprint = try CredentialWire.identity(object["endpointFingerprint"])
    }

    var array: [Any] { [profileID, profileRevision, endpointFingerprint] }
    var object: [String: Any] {
        ["profileId": profileID, "profileRevision": profileRevision, "endpointFingerprint": endpointFingerprint]
    }

    static func optional(_ value: Any?) throws -> CredentialSource? {
        guard let value else { throw CredentialFailure.invalidMessage }
        if value is NSNull { return nil }
        return try CredentialSource(value)
    }
}

struct CredentialChannelOwner: Equatable, Sendable {
    let sidebarInstanceID: String
    let senderID: String
    let drawerID: String
}

struct CredentialChannelOffer: Sendable {
    let owner: CredentialChannelOwner
    let helperSessionID: String
    let channelID: String
    let source: CredentialSource?
    let clientPublicKey: Data
    let helperPublicKey: Data
    let salt: Data

    var object: [String: Any] {
        ["protocolVersion": 2, "sidebarInstanceId": owner.sidebarInstanceID,
         "senderId": owner.senderID, "drawerId": owner.drawerID,
         "helperSessionId": helperSessionID, "channelId": channelID,
         "sourceProfile": source.map { $0.object as Any } ?? NSNull(),
         "clientPublicKey": clientPublicKey.base64EncodedString(),
         "helperPublicKey": helperPublicKey.base64EncodedString(), "salt": salt.base64EncodedString()]
    }

    func keyInfo(_ direction: String) throws -> Data {
        try CredentialWire.array(["subtandem-channel", 2, helperSessionID, owner.sidebarInstanceID,
                                  channelID, owner.senderID, owner.drawerID, direction])
    }

    func handshakeAAD(_ direction: String) throws -> Data {
        try CredentialWire.array(["subtandem-channel-handshake", 2, direction, helperSessionID,
                                  owner.sidebarInstanceID, channelID, owner.senderID, owner.drawerID,
                                  clientPublicKey.base64EncodedString(), helperPublicKey.base64EncodedString(),
                                  salt.base64EncodedString(), source.map { $0.array as Any } ?? NSNull()])
    }
}

struct CredentialContext: Sendable {
    let requestID: String
    let draftRevision: Int64
    let keyEditEpoch: Int64
    let submitEpoch: Int64
    let purpose: String
    let source: CredentialSource?
    let kind: String
    let endpointFingerprint: String
    let snapshotDigest: String
    let expiresAtMilliseconds: Int64

    init(_ value: Any) throws {
        let r = try CredentialWire.record(value, keys: ["requestId", "draftRevision", "keyEditEpoch", "submitEpoch", "purpose", "sourceProfile", "kind", "endpointFingerprint", "snapshotDigest", "expiresAtMs"])
        requestID = try CredentialWire.identity(r["requestId"])
        draftRevision = try CredentialWire.integer(r["draftRevision"])
        keyEditEpoch = try CredentialWire.integer(r["keyEditEpoch"])
        submitEpoch = try CredentialWire.integer(r["submitEpoch"])
        guard let purpose = r["purpose"] as? String, CredentialWire.purposes.contains(purpose),
              let kind = r["kind"] as? String, CredentialWire.kinds.contains(kind),
              let digest = r["snapshotDigest"] as? String,
              digest.range(of: "^[0-9a-f]{64}$", options: .regularExpression) != nil
        else { throw CredentialFailure.invalidMessage }
        self.purpose = purpose
        self.kind = kind
        snapshotDigest = digest
        source = try CredentialSource.optional(r["sourceProfile"])
        endpointFingerprint = try CredentialWire.identity(r["endpointFingerprint"])
        expiresAtMilliseconds = try CredentialWire.integer(r["expiresAtMs"], minimum: 1)
    }

    var object: [String: Any] {
        ["requestId": requestID, "draftRevision": draftRevision, "keyEditEpoch": keyEditEpoch,
         "submitEpoch": submitEpoch, "purpose": purpose, "sourceProfile": source.map { $0.object as Any } ?? NSNull(),
         "kind": kind, "endpointFingerprint": endpointFingerprint, "snapshotDigest": snapshotDigest,
         "expiresAtMs": expiresAtMilliseconds]
    }

    func aad(offer: CredentialChannelOffer, direction: String, sequence: Int64) throws -> Data {
        try CredentialWire.array(["subtandem-channel-operation", 2, direction, offer.helperSessionID,
                                  offer.owner.sidebarInstanceID, offer.channelID, offer.owner.senderID,
                                  offer.owner.drawerID, sequence, requestID, draftRevision, keyEditEpoch,
                                  submitEpoch, purpose, source.map { $0.array as Any } ?? NSNull(), kind,
                                  endpointFingerprint, snapshotDigest, expiresAtMilliseconds])
    }
}

struct CredentialSealedOperation: Sendable {
    let channelID: String
    let helperSessionID: String
    let sequence: Int64
    let context: CredentialContext
    let snapshot: Data
    let sealed: Data

    init(_ value: Any) throws {
        let r = try CredentialWire.record(value, keys: ["protocolVersion", "channelId", "helperSessionId", "sequence", "context", "snapshotBytes", "sealedPayload"])
        guard try CredentialWire.integer(r["protocolVersion"]) == 2 else { throw CredentialFailure.protocolMismatch }
        channelID = try CredentialWire.identity(r["channelId"])
        helperSessionID = try CredentialWire.identity(r["helperSessionId"])
        sequence = try CredentialWire.integer(r["sequence"], minimum: 1, maximum: Int64(CredentialWire.messageLimit - 1))
        context = try CredentialContext(r["context"] as Any)
        snapshot = try CredentialWire.base64(r["snapshotBytes"], maximum: CredentialWire.documentBytes)
        sealed = try CredentialWire.base64(r["sealedPayload"], maximum: CredentialWire.sealedBytes)
        guard sealed.count >= 16 else { throw CredentialFailure.invalidMessage }
    }

    var object: [String: Any] {
        ["protocolVersion": 2, "channelId": channelID, "helperSessionId": helperSessionID,
         "sequence": sequence, "context": context.object, "snapshotBytes": snapshot.base64EncodedString(),
         "sealedPayload": sealed.base64EncodedString()]
    }
}

struct SavedCredentialReference: Sendable {
    let profile: CredentialSource
    let kind: String
}
struct DraftCredentialReference: Sendable {
    let operationID: String
    let channelID: String
    let requestID: String
    let owner: CredentialChannelOwner
    let purpose: String
    let snapshotDigest: String
    let deadlineMilliseconds: Int64
}
enum CredentialReference: Sendable {
    case saved(SavedCredentialReference)
    case draft(DraftCredentialReference)
    case none
}
