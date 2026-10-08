import CryptoKit
import Foundation

struct CredentialOperationPeer {
    let handler: ProtocolHandler
    let offer: CredentialChannelOffer
    let sendKey: Data
    let receiveKey: Data

    static func open(_ handler: ProtocolHandler, source: CredentialSource? = nil, senderID: String = "operation-window", drawerID: String = "operation-drawer") async throws -> Self {
        let owner = CredentialChannelOwner(sidebarInstanceID: "operation-sidebar", senderID: senderID, drawerID: drawerID)
        let key = P256.KeyAgreement.PrivateKey()
        let opening: [String: Any] = ["protocolVersion": 2, "sidebarInstanceId": owner.sidebarInstanceID, "senderId": senderID, "drawerId": drawerID, "sourceProfile": source.map { $0.object as Any } ?? NSNull(), "clientPublicKey": key.publicKey.x963Representation.base64EncodedString()]
        let response = await handler.handle(path: "/v2/credential-channel", authorization: "Bearer operation-token", body: try JSONSerialization.data(withJSONObject: ["action": "open", "payload": opening]))
        try check(response.statusCode == 200, "operation peer must open the production channel")
        let raw = try JSONSerialization.jsonObject(with: response.body) as! [String: Any]
        let offer = CredentialChannelOffer(owner: owner, helperSessionID: raw["helperSessionId"] as! String, channelID: raw["channelId"] as! String, source: source, clientPublicKey: key.publicKey.x963Representation, helperPublicKey: try CredentialWire.base64(raw["helperPublicKey"], maximum: 65), salt: try CredentialWire.base64(raw["salt"], maximum: 32))
        let sendKey = try CredentialCryptography.derive(privateKey: key.rawRepresentation, publicKey: offer.helperPublicKey, salt: offer.salt, info: offer.keyInfo("sidebar-to-helper"))
        let receiveKey = try CredentialCryptography.derive(privateKey: key.rawRepresentation, publicKey: offer.helperPublicKey, salt: offer.salt, info: offer.keyInfo("helper-to-sidebar"))
        let confirmation: [String: Any] = ["protocolVersion": 2, "channelId": offer.channelID, "helperSessionId": offer.helperSessionID, "sequence": 0, "sealedPayload": try CredentialCryptography.seal(key: sendKey, nonce: CredentialWire.nonce(0), value: Data(), aad: offer.handshakeAAD("sidebar-to-helper")).base64EncodedString()]
        let confirmed = await handler.handle(path: "/v2/credential-channel", authorization: "Bearer operation-token", body: try JSONSerialization.data(withJSONObject: ["action": "confirm", "payload": ["owner": ownerObject(owner), "frame": confirmation]]))
        try check(confirmed.statusCode == 200, "operation peer must authenticate the production channel")
        return Self(handler: handler, offer: offer, sendKey: sendKey, receiveKey: receiveKey)
    }

    static func ownerObject(_ owner: CredentialChannelOwner) -> [String: Any] {
        ["senderId": owner.senderID, "sidebarInstanceId": owner.sidebarInstanceID, "drawerId": owner.drawerID]
    }

    func frame(_ value: String, purpose: String, endpoint: String, sequence: Int64 = 1, deadline: Int64? = nil) throws -> [String: Any] {
        let fingerprint = CredentialCryptography.digest(try JSONSerialization.data(withJSONObject: ["kind": "openai", "endpoint": endpoint, "proxyMode": "direct"], options: [.sortedKeys, .withoutEscapingSlashes]))
        let snapshot: [String: Any] = ["kind": "openai", "endpoint": endpoint, "model": "model-a", "proxyMode": "direct", "purpose": purpose, "sourceProfile": offer.source.map { $0.object as Any } ?? NSNull(), "save": NSNull()]
        let bytes = try JSONSerialization.data(withJSONObject: snapshot, options: [.withoutEscapingSlashes])
        let context = try CredentialContext(["requestId": "operation-\(sequence)", "draftRevision": 1, "keyEditEpoch": 1, "submitEpoch": 0, "purpose": purpose, "sourceProfile": offer.source.map { $0.object as Any } ?? NSNull(), "kind": "openai", "endpointFingerprint": fingerprint, "snapshotDigest": CredentialCryptography.digest(bytes), "expiresAtMs": deadline ?? Int64(Date().timeIntervalSince1970 * 1000) + 30_000])
        return ["protocolVersion": 2, "channelId": offer.channelID, "helperSessionId": offer.helperSessionID, "sequence": sequence, "context": context.object, "snapshotBytes": bytes.base64EncodedString(), "sealedPayload": try CredentialCryptography.seal(key: sendKey, nonce: CredentialWire.nonce(sequence), value: Data(value.utf8), aad: context.aad(offer: offer, direction: "sidebar-to-helper", sequence: sequence)).base64EncodedString()]
    }

    func draft(_ action: String, frame: [String: Any]? = nil, reference: [String: Any]? = nil) async throws -> ProtocolResponse {
        var input: [String: Any] = ["action": action, "owner": Self.ownerObject(offer.owner)]
        if let frame { input["frame"] = frame }
        if let reference { input["reference"] = reference }
        return await handler.handle(path: "/v2/draft-operation", authorization: "Bearer operation-token", body: try JSONSerialization.data(withJSONObject: input))
    }
}

func runCredentialOperationTests() async throws {
    let directory = FileManager.default.temporaryDirectory.appendingPathComponent("subtandem-credential-operation-\(UUID().uuidString)")
    defer { try? FileManager.default.removeItem(at: directory) }
    let store = try SecureCredentialStore(directory: directory, protection: CredentialProtection(backend: SyntheticKeyBackend()))
    _ = try await store.initializeProfileState(commitID: UUID().uuidString, expectedStoreRevision: 0, profiles: [])
    let handler = ProtocolHandler(token: "operation-token", credentialStore: store)
    let server = try CredentialCaptureServer()
    let port = try await server.start()
    defer { server.stop() }
    let endpoint = "http://127.0.0.1:\(port)"
    let peer = try await CredentialOperationPeer.open(handler)
    let frame = try peer.frame("synthetic-operation-key", purpose: "draft-test", endpoint: endpoint)
    let began = try await peer.draft("begin", frame: frame)
    try check(began.statusCode == 200, "production helper must begin an encrypted draft operation")
    let reference = try JSONSerialization.jsonObject(with: began.body) as! [String: Any]
    let repeatBegin = try await peer.draft("begin", frame: frame)
    try check(repeatBegin.statusCode == 200 && repeatBegin.body == began.body, "same live sealed frame must reuse exactly one operation reference")
    let before = try Data(contentsOf: directory.appendingPathComponent("credentials.json"))
    func request(_ reference: [String: Any], owner: String = "operation-window", requestID: String = "operation-1", model: String = "model-a", endpoint override: String? = nil) async throws -> ProtocolResponse {
        let root = override ?? endpoint
        return await handler.handle(path: "/v2/request", authorization: "Bearer operation-token", body: try JSONSerialization.data(withJSONObject: ["jobId": UUID().uuidString, "method": "POST", "url": root + "/v1/chat/completions", "headers": ["Content-Type": "application/json"], "proxyMode": "direct", "timeoutMs": 10_000, "maxResponseBytes": 1048576, "credential": reference, "provider": ["kind": "openai", "endpoint": root, "model": model, "proxyMode": "direct"], "purpose": "test", "owner": ["senderId": owner, "requestId": requestID], "body": ["model": model]]))
    }
    let first = try await request(reference)
    try check(first.statusCode == 200 && server.requests().last!.contains("Bearer synthetic-operation-key"), "draft key must reach only the production native provider request")
    let wrongOwner = try await request(reference, owner: "other-window")
    let wrongModel = try await request(reference, model: "changed-model")
    let wrongEndpoint = try await request(reference, endpoint: endpoint + "/other")
    try check(wrongOwner.statusCode != 200 && wrongModel.statusCode != 200 && wrongEndpoint.statusCode != 200 && server.requests().count == 1, "draft reference must bind real owner, snapshot model and destination")
    let finished = try await peer.draft("finish", reference: reference)
    try check(finished.statusCode == 200, "finish must destroy the operation")
    let late = try await request(reference)
    let replay = try await peer.draft("begin", frame: frame)
    try check(late.statusCode != 200 && replay.statusCode != 200 && server.requests().count == 1, "finished reference and identical late begin must not revive credentials")
    let after = try Data(contentsOf: directory.appendingPathComponent("credentials.json"))
    try check(before == after, "draft operations must not persist or enable a Profile")
    let emptyFrame = try peer.frame("", purpose: "draft-test", endpoint: endpoint, sequence: 2)
    let emptyBegin = try await peer.draft("begin", frame: emptyFrame)
    let emptyReference = try JSONSerialization.jsonObject(with: emptyBegin.body) as! [String: Any]
    let emptyHTTP = try await request(emptyReference, requestID: "operation-2")
    try check(emptyHTTP.statusCode == 200 && !server.requests().last!.lowercased().contains("authorization:"), "empty draft must execute without borrowing a saved credential")
    var emptyRequest = emptyReference
    emptyRequest["requestId"] = "operation-1"
    let forged = try await request(emptyRequest)
    try check(forged.statusCode != 200, "reference request identity must be immutable")
    _ = try await peer.draft("cancel", reference: emptyReference)
    let cancelled = try await peer.draft("begin", frame: emptyFrame)
    try check(cancelled.statusCode != 200, "cancelled sealed operation must retain its tombstone")
    let earlyFrame = try peer.frame("synthetic-early-cancel-key", purpose: "draft-test", endpoint: endpoint, sequence: 3)
    _ = try await peer.draft("cancel", frame: earlyFrame)
    let earlyBegin = try await peer.draft("begin", frame: earlyFrame)
    try check(earlyBegin.statusCode != 200, "cancel arriving before begin must prevent late activation")
    let timedFrame = try peer.frame("synthetic-expired-key", purpose: "draft-test", endpoint: endpoint, sequence: 4, deadline: Int64(Date().timeIntervalSince1970 * 1000) + 150)
    let timedBegin = try await peer.draft("begin", frame: timedFrame)
    try check(timedBegin.statusCode == 200, "short absolute operation must begin")
    let timedReference = try JSONSerialization.jsonObject(with: timedBegin.body) as! [String: Any]
    server.respond(body: "{}", delayNanoseconds: 400_000_000)
    let timedHTTP = try await request(timedReference, requestID: "operation-4")
    try check(timedHTTP.statusCode != 200, "helper deadline must revoke an in-flight child without finish")
    let timedReplay = try await peer.draft("begin", frame: timedFrame)
    try check(timedReplay.statusCode != 200, "expired envelope must never restart its budget")
    server.respond(body: "{}")
    let otherPeer = try await CredentialOperationPeer.open(handler, senderID: "other-window", drawerID: "other-drawer")
    let otherFrame = try otherPeer.frame("synthetic-other-window-key", purpose: "draft-test", endpoint: endpoint)
    let otherBegin = try await otherPeer.draft("begin", frame: otherFrame)
    let otherReference = try JSONSerialization.jsonObject(with: otherBegin.body) as! [String: Any]
    let closedFrame = try peer.frame("synthetic-closed-window-key", purpose: "draft-test", endpoint: endpoint, sequence: 5)
    let closedBegin = try await peer.draft("begin", frame: closedFrame)
    let closedReference = try JSONSerialization.jsonObject(with: closedBegin.body) as! [String: Any]
    _ = await handler.handle(path: "/v2/credential-channel", authorization: "Bearer operation-token", body: try JSONSerialization.data(withJSONObject: ["action": "close", "payload": ["owner": CredentialOperationPeer.ownerObject(peer.offer.owner)]]))
    let closedHTTP = try await request(closedReference, requestID: "operation-5")
    let otherHTTP = try await request(otherReference, owner: "other-window")
    try check(closedHTTP.statusCode != 200 && otherHTTP.statusCode == 200 && server.requests().last!.contains("synthetic-other-window-key"), "closing one owner must destroy only that owner's draft")
    let restarted = ProtocolHandler(token: "operation-token", credentialStore: store)
    let restartedBegin = await restarted.handle(path: "/v2/draft-operation", authorization: "Bearer operation-token", body: try JSONSerialization.data(withJSONObject: ["action": "begin", "owner": CredentialOperationPeer.ownerObject(otherPeer.offer.owner), "frame": otherFrame]))
    try check(restartedBegin.statusCode != 200, "new helper session must reject old operations")
    let renewedPeer = try await CredentialOperationPeer.open(handler, senderID: "other-window", drawerID: "other-drawer")
    let staleClose = await handler.handle(path: "/v2/credential-channel", authorization: "Bearer operation-token", body: try JSONSerialization.data(withJSONObject: ["action": "close", "payload": ["owner": CredentialOperationPeer.ownerObject(otherPeer.offer.owner), "channelId": otherPeer.offer.channelID]]))
    let renewedFrame = try renewedPeer.frame("synthetic-renewed-key", purpose: "draft-test", endpoint: endpoint)
    let renewedBegin = try await renewedPeer.draft("begin", frame: renewedFrame)
    try check(staleClose.statusCode == 200 && renewedBegin.statusCode == 200, "late close must not destroy a renewed channel for the same drawer")
    let readPeer = try await CredentialOperationPeer.open(handler, senderID: "read-window", drawerID: "read-drawer")
    let readFrame = try readPeer.frame("", purpose: "read-edit", endpoint: endpoint)
    let read = await handler.handle(path: "/v2/credential-channel", authorization: "Bearer operation-token", body: try JSONSerialization.data(withJSONObject: ["action": "operation", "payload": ["owner": CredentialOperationPeer.ownerObject(readPeer.offer.owner), "frame": readFrame]]))
    try check(read.statusCode == 200, "new Profile must return an authenticated encrypted empty edit value")
    let response = try CredentialSealedOperation(JSONSerialization.jsonObject(with: read.body))
    let value = try CredentialCryptography.open(key: readPeer.receiveKey, nonce: CredentialWire.nonce(response.sequence), sealed: response.sealed, aad: response.context.aad(offer: readPeer.offer, direction: "helper-to-sidebar", sequence: response.sequence))
    try check(value.isEmpty, "no credential must be represented by empty encrypted bytes")
    let repeatRead = try readPeer.frame("", purpose: "read-edit", endpoint: endpoint, sequence: 2)
    let repeated = await handler.handle(path: "/v2/credential-channel", authorization: "Bearer operation-token", body: try JSONSerialization.data(withJSONObject: ["action": "operation", "payload": ["owner": CredentialOperationPeer.ownerObject(readPeer.offer.owner), "frame": repeatRead]]))
    try check(repeated.statusCode != 200, "active drawer read must be one-shot even with a fresh sequence")
    let id = UUID().uuidString.lowercased()
    let fingerprint = CredentialCryptography.digest(try JSONSerialization.data(withJSONObject: ["kind": "openai", "endpoint": endpoint, "proxyMode": "direct"], options: [.sortedKeys, .withoutEscapingSlashes]))
    let profile = StoredProviderProfile(profileId: id, revision: 1, displayName: "Read Profile", kind: "openai", endpoint: endpoint, endpointFingerprint: fingerprint, proxyMode: "direct", model: "model-a", capability: nil)
    let current = try await store.readProfileState()
    let commit = UUID().uuidString
    _ = try await store.saveProfile(CredentialProfileSave(commitID: commit, expectedStoreRevision: current.storeRevision, expectedProfileRevision: 0, profileID: id, profileState: StoredProfileState(profiles: [profile], activation: nil), requestDigest: CredentialCryptography.digest(Data(commit.utf8))), value: Data("synthetic-current-edit-key".utf8))
    let source = try CredentialSource(["profileId": id, "profileRevision": 1, "endpointFingerprint": fingerprint])
    let savedPeer = try await CredentialOperationPeer.open(handler, source: source, senderID: "saved-read-window")
    let savedFrame = try savedPeer.frame("", purpose: "read-edit", endpoint: endpoint)
    let savedRead = await handler.handle(path: "/v2/credential-channel", authorization: "Bearer operation-token", body: try JSONSerialization.data(withJSONObject: ["action": "operation", "payload": ["owner": CredentialOperationPeer.ownerObject(savedPeer.offer.owner), "frame": savedFrame]]))
    try check(savedRead.statusCode == 200 && savedRead.body.range(of: Data("synthetic-current-edit-key".utf8)) == nil, "current edit read must return only an encrypted value")
    let savedEnvelope = try CredentialSealedOperation(JSONSerialization.jsonObject(with: savedRead.body))
    let savedValue = try CredentialCryptography.open(key: savedPeer.receiveKey, nonce: CredentialWire.nonce(savedEnvelope.sequence), sealed: savedEnvelope.sealed, aad: savedEnvelope.context.aad(offer: savedPeer.offer, direction: "helper-to-sidebar", sequence: savedEnvelope.sequence))
    try check(savedValue == Data("synthetic-current-edit-key".utf8), "current drawer must receive the editable original value")
    let file = directory.appendingPathComponent("credentials.json")
    var damaged = try JSONSerialization.jsonObject(with: Data(contentsOf: file)) as! [String: Any]
    var credentials = damaged["credentials"] as! [String: Any]
    credentials[id] = ["credentialId": UUID().uuidString, "envelope": "damaged"]
    damaged["credentials"] = credentials
    let damagedBytes = try JSONSerialization.data(withJSONObject: damaged)
    try damagedBytes.write(to: file)
    let damagedPeer = try await CredentialOperationPeer.open(handler, source: source, senderID: "damaged-read-window")
    let damagedFrame = try damagedPeer.frame("", purpose: "read-edit", endpoint: endpoint)
    let damagedRead = await handler.handle(path: "/v2/credential-channel", authorization: "Bearer operation-token", body: try JSONSerialization.data(withJSONObject: ["action": "operation", "payload": ["owner": CredentialOperationPeer.ownerObject(damagedPeer.offer.owner), "frame": damagedFrame]]))
    try check(damagedRead.statusCode != 200, "damaged credential must return a secret-free read failure")
    try credentialCheck(Data(contentsOf: file) == damagedBytes, "read failure must preserve opaque stored data")
    let damagedState = try await store.readProfileState()
    try check(damagedState.credentialConfigured[id] == true, "read failure must not clear configured state")
}
