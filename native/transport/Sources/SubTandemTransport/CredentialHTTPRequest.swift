import Foundation

struct CredentialHTTPRequest: Sendable {
    let request: TransportRequest
    let credential: CredentialReference
    let kind: String
    let endpoint: String
    let model: String?
    let purpose: String
    let senderID: String
    let requestID: String

    init(_ data: Data) throws {
        guard let raw = try JSONSerialization.jsonObject(with: data) as? [String: Any] else { throw TransportProtocolError.invalidRequest }
        let optional = raw["body"] == nil ? [] : ["body"]
        let json = try CredentialWire.record(raw, keys: ["jobId", "method", "url", "headers", "proxyMode", "timeoutMs", "maxResponseBytes", "credential", "provider", "purpose", "owner"] + optional)
        let provider = try CredentialWire.record(json["provider"] as Any, keys: ["kind", "endpoint", "model", "proxyMode"])
        let owner = try CredentialWire.record(json["owner"] as Any, keys: ["senderId", "requestId"])
        senderID = try CredentialWire.identity(owner["senderId"])
        requestID = try CredentialWire.identity(owner["requestId"])
        guard let kind = provider["kind"] as? String, CredentialWire.kinds.contains(kind),
              let endpoint = provider["endpoint"] as? String, endpoint.utf8.count <= 8192,
              endpoint == endpoint.trimmingCharacters(in: .whitespacesAndNewlines),
              let rootURL = URLComponents(string: endpoint), rootURL.query == nil, rootURL.fragment == nil,
              let endpointURL = rootURL.url,
              let proxy = provider["proxyMode"] as? String, ["system", "direct"].contains(proxy),
              json["proxyMode"] as? String == proxy,
              let purpose = json["purpose"] as? String, ["models", "test", "translation"].contains(purpose),
              provider["model"] is NSNull || provider["model"] is String,
              let jobID = json["jobId"] as? String, let method = json["method"] as? String,
              let url = json["url"] as? String, let headers = json["headers"] as? [String: String]
        else { throw TransportProtocolError.invalidRequest }
        try UpstreamPolicy.validate(endpointURL)
        self.kind = kind
        self.endpoint = endpoint
        self.model = provider["model"] as? String
        self.purpose = purpose
        guard model == nil || (model!.utf8.count <= 1024 && !model!.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty) else { throw TransportProtocolError.invalidRequest }
        let headerNames = headers.keys.map { $0.lowercased() }
        guard Set(headerNames).count == headers.count,
              Set(headerNames).isSubset(of: ["content-type", "accept", "anthropic-version", "x-session-id"]),
              headers.allSatisfy({ !$0.value.contains("\n") && !$0.value.contains("\r") && !$0.value.contains("\0") })
        else { throw TransportProtocolError.invalidRequest }
        let body: Data
        if let value = json["body"] {
            guard let object = value as? [String: Any], method == "POST", let model,
                  object["model"] as? String == model
            else { throw TransportProtocolError.invalidRequest }
            body = try JSONSerialization.data(withJSONObject: object)
        } else {
            guard method == "GET" else { throw TransportProtocolError.invalidRequest }
            body = Data()
        }
        let root = endpoint.replacingOccurrences(of: #"/+$"#, with: "", options: .regularExpression)
        let apiRoot = kind == "claude" && root.range(of: #"/v1$"#, options: [.regularExpression, .caseInsensitive]) == nil ? root + "/v1" : root
        let paths: [String]
        if purpose == "models" {
            guard method == "GET" else { throw TransportProtocolError.invalidRequest }
            paths = [apiRoot + (kind == "ollama" ? "/api/tags" : "/models")]
        } else if kind == "ollama" && method == "GET" {
            guard purpose == "test" else { throw TransportProtocolError.invalidRequest }
            paths = [root + "/api/version", root + "/api/tags"]
        } else {
            guard method == "POST" else { throw TransportProtocolError.invalidRequest }
            paths = [apiRoot + (kind == "claude" ? "/messages" : kind == "ollama" ? "/api/chat" : "/chat/completions")]
        }
        if !paths.contains(url) {
            guard kind == "claude", purpose == "models", let actual = URLComponents(string: url),
                  actual.fragment == nil, let query = actual.queryItems, query.count == 1,
                  query[0].name == "after_id", let cursor = query[0].value, !cursor.isEmpty, cursor.utf8.count <= 4096,
                  url.components(separatedBy: "?").first == paths.first
            else { throw TransportProtocolError.forbiddenDestination }
        }
        let reference = json["credential"] as? [String: Any]
        switch reference?["source"] as? String {
        case "none":
            _ = try CredentialWire.record(reference as Any, keys: ["source"])
            credential = .none
        case "saved":
            let saved = try CredentialWire.record(reference as Any, keys: ["source", "profileId", "profileRevision", "kind", "endpointFingerprint"])
            guard saved["kind"] as? String == kind else { throw CredentialFailure.ownerMismatch }
            credential = .saved(SavedCredentialReference(profile: try CredentialSource(["profileId": saved["profileId"] as Any, "profileRevision": saved["profileRevision"] as Any, "endpointFingerprint": saved["endpointFingerprint"] as Any]), kind: kind))
        case "draft":
            credential = .draft(try DraftCredentialReference(reference as Any))
        default:
            throw CredentialFailure.invalidMessage
        }
        request = try TransportRequest(jobID: jobID, method: method, url: url, headers: headers, proxyMode: proxy, body: body, timeoutMilliseconds: Int(CredentialWire.integer(json["timeoutMs"])), maxResponseBytes: Int(CredentialWire.integer(json["maxResponseBytes"]))).validated()
    }
}
