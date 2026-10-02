import CryptoKit
import Foundation

enum CredentialCryptography {
    static func derive(privateKey: Data, publicKey: Data, salt: Data, info: Data) throws -> Data {
        guard privateKey.count == 32, publicKey.count == 65, publicKey.first == 4, salt.count == 32 else { throw CredentialFailure.invalidMessage }
        let local = try P256.KeyAgreement.PrivateKey(rawRepresentation: privateKey)
        let peer = try P256.KeyAgreement.PublicKey(x963Representation: publicKey)
        let secret = try local.sharedSecretFromKeyAgreement(with: peer)
        return secret.hkdfDerivedSymmetricKey(using: SHA256.self, salt: salt, sharedInfo: info, outputByteCount: 32).withUnsafeBytes { Data($0) }
    }
    static func seal(key: Data, nonce: Data, value: Data, aad: Data) throws -> Data {
        guard key.count == 32, nonce.count == 12, value.count <= CredentialWire.keyBytes else { throw CredentialFailure.tooLarge }
        let box = try AES.GCM.seal(value, using: SymmetricKey(data: key), nonce: AES.GCM.Nonce(data: nonce), authenticating: aad)
        return box.ciphertext + box.tag
    }
    static func open(key: Data, nonce: Data, sealed: Data, aad: Data) throws -> Data {
        guard key.count == 32, nonce.count == 12, sealed.count >= 16, sealed.count <= CredentialWire.sealedBytes else { throw CredentialFailure.invalidMessage }
        do {
            let box = try AES.GCM.SealedBox(nonce: AES.GCM.Nonce(data: nonce), ciphertext: sealed.dropLast(16), tag: sealed.suffix(16))
            var value = try AES.GCM.open(box, using: SymmetricKey(data: key), authenticating: aad)
            guard value.count <= CredentialWire.keyBytes, String(data: value, encoding: .utf8) != nil else {
                value.resetBytes(in: 0..<value.count)
                throw CredentialFailure.tooLarge
            }
            return value
        } catch { throw CredentialFailure.authentication }
    }
    static func digest(_ value: Data) -> String { SHA256.hash(data: value).map { String(format: "%02x", $0) }.joined() }
}

struct CredentialSequenceState {
    private var received = Set<Int64>()
    private var highest: Int64 = 0
    mutating func accept(_ sequence: Int64) throws {
        guard sequence > 0, sequence < CredentialWire.messageLimit,
              sequence > highest - Int64(CredentialWire.receiveWindow), !received.contains(sequence)
        else { throw CredentialFailure.replay }
        received.insert(sequence)
        highest = max(highest, sequence)
        received = received.filter { $0 > highest - Int64(CredentialWire.receiveWindow) }
    }
}

struct CredentialOpenedOperation: Sendable {
    let envelope: CredentialSealedOperation
    let owner: CredentialChannelOwner
    var value: Data
}

actor CredentialChannelManager {
    private final class Draft {
        let reference: DraftCredentialReference
        let frameDigest: String
        let envelope: CredentialSealedOperation
        let cancelJob: @Sendable (String) async -> Void
        var phase = "preparing"
        var value = Data()
        var jobs = Set<String>()
        var beginning: Task<DraftCredentialReference, Error>?
        var deadlineTask: Task<Void, Never>?
        init(reference: DraftCredentialReference, frameDigest: String, envelope: CredentialSealedOperation, cancelJob: @escaping @Sendable (String) async -> Void) {
            self.reference = reference
            self.frameDigest = frameDigest
            self.envelope = envelope
            self.cancelJob = cancelJob
        }
        deinit { value.resetBytes(in: 0..<value.count); deadlineTask?.cancel() }
    }
    private final class Session {
        let offer: CredentialChannelOffer
        var sendKey: Data
        var receiveKey: Data
        var confirmed = false
        var sequence: Int64 = 1
        var received = CredentialSequenceState()
        var count = 0
        var lastActivity: Int64
        var pending: [String: CredentialSealedOperation] = [:]
        var readUsed = false
        init(offer: CredentialChannelOffer, privateKey: Data, now: Int64) throws {
            self.offer = offer
            self.lastActivity = now
            sendKey = try CredentialCryptography.derive(privateKey: privateKey, publicKey: offer.clientPublicKey, salt: offer.salt, info: offer.keyInfo("helper-to-sidebar"))
            receiveKey = try CredentialCryptography.derive(privateKey: privateKey, publicKey: offer.clientPublicKey, salt: offer.salt, info: offer.keyInfo("sidebar-to-helper"))
        }
        deinit {
            sendKey.resetBytes(in: 0..<sendKey.count)
            receiveKey.resetBytes(in: 0..<receiveKey.count)
        }
    }
    let helperSessionID: String
    private let now: @Sendable () -> Int64
    private var sessions: [String: Session] = [:]
    private var generations: [String: Int] = [:]
    private var registeredOwners: [String: CredentialChannelOwner] = [:]
    private var drafts: [String: Draft] = [:]

    init(helperSessionID: String = UUID().uuidString.lowercased(), now: @escaping @Sendable () -> Int64 = { Int64(Date().timeIntervalSince1970 * 1000) }) {
        self.helperSessionID = helperSessionID
        self.now = now
    }

    func open(_ data: Data, senderID: String, validateSource: @Sendable (CredentialSource?) async throws -> Void) async throws -> Data {
        guard data.count <= ProtocolLimits.maxRequestBytes else { throw CredentialFailure.tooLarge }
        let r = try CredentialWire.record(JSONSerialization.jsonObject(with: data), keys: ["protocolVersion", "sidebarInstanceId", "drawerId", "sourceProfile", "clientPublicKey"])
        guard try CredentialWire.integer(r["protocolVersion"]) == 2 else { throw CredentialFailure.protocolMismatch }
        let owner = CredentialChannelOwner(sidebarInstanceID: try CredentialWire.identity(r["sidebarInstanceId"]), senderID: try CredentialWire.identity(senderID), drawerID: try CredentialWire.identity(r["drawerId"]))
        let source = try CredentialSource.optional(r["sourceProfile"])
        let peer = try CredentialWire.base64(r["clientPublicKey"], maximum: 65, exact: 65)
        guard peer.first == 4 else { throw CredentialFailure.invalidMessage }
        _ = try P256.KeyAgreement.PublicKey(x963Representation: peer)
        close(senderID: senderID)
        let generation = generations[senderID]!
        registeredOwners[senderID] = owner
        try await validateSource(source)
        guard generations[senderID] == generation else { throw CredentialFailure.ownerMismatch }
        prune()
        guard sessions.count < 64 else { throw CredentialFailure.channelUnavailable }
        let key = P256.KeyAgreement.PrivateKey(compactRepresentable: false)
        let offer = CredentialChannelOffer(owner: owner, helperSessionID: helperSessionID, channelID: UUID().uuidString.lowercased(), source: source, clientPublicKey: peer, helperPublicKey: key.publicKey.x963Representation, salt: try SecureRandom.bytes(count: 32))
        sessions[offer.channelID] = try Session(offer: offer, privateKey: key.rawRepresentation, now: now())
        return try JSONSerialization.data(withJSONObject: offer.object, options: [.withoutEscapingSlashes])
    }

    func confirm(_ data: Data, owner: CredentialChannelOwner) throws -> Data {
        let r = try CredentialWire.record(JSONSerialization.jsonObject(with: data), keys: ["protocolVersion", "channelId", "helperSessionId", "sequence", "sealedPayload"])
        let channelID = try CredentialWire.identity(r["channelId"])
        let session = try active(channelID, owner: owner)
        do {
            guard try CredentialWire.integer(r["protocolVersion"]) == 2,
                  r["helperSessionId"] as? String == helperSessionID,
                  try CredentialWire.integer(r["sequence"]) == 0, !session.confirmed
            else { throw CredentialFailure.authentication }
            let value = try CredentialCryptography.open(key: session.receiveKey, nonce: CredentialWire.nonce(0), sealed: CredentialWire.base64(r["sealedPayload"], maximum: 16, exact: 16), aad: session.offer.handshakeAAD("sidebar-to-helper"))
            guard value.isEmpty else { throw CredentialFailure.authentication }
            session.confirmed = true
            session.count = 2
            session.lastActivity = now()
            let sealed = try CredentialCryptography.seal(key: session.sendKey, nonce: CredentialWire.nonce(0), value: Data(), aad: session.offer.handshakeAAD("helper-to-sidebar"))
            return try JSONSerialization.data(withJSONObject: ["protocolVersion": 2, "channelId": channelID, "helperSessionId": helperSessionID, "sequence": 0, "sealedPayload": sealed.base64EncodedString()])
        } catch {
            sessions.removeValue(forKey: channelID)
            throw CredentialFailure.authentication
        }
    }

    func decrypt(_ data: Data, owner: CredentialChannelOwner, validateSource: @Sendable (CredentialSource?) async throws -> Void) async throws -> CredentialOpenedOperation {
        guard data.count <= ProtocolLimits.maxRequestBytes else { throw CredentialFailure.tooLarge }
        let operation = try CredentialSealedOperation(JSONSerialization.jsonObject(with: data))
        let session = try active(operation.channelID, owner: owner)
        guard session.confirmed, operation.helperSessionID == helperSessionID,
              operation.context.source == session.offer.source,
              operation.context.expiresAtMilliseconds > now(),
              operation.context.expiresAtMilliseconds <= now() + CredentialWire.idleMilliseconds,
              session.pending[operation.context.requestID] == nil
        else { throw CredentialFailure.ownerMismatch }
        try Self.validateSnapshot(operation)
        try await validateSource(operation.context.source)
        guard try active(operation.channelID, owner: owner) === session,
              operation.context.expiresAtMilliseconds > now()
        else { throw CredentialFailure.ownerMismatch }
        var replay = session.received
        try replay.accept(operation.sequence)
        var value = try CredentialCryptography.open(key: session.receiveKey, nonce: CredentialWire.nonce(operation.sequence), sealed: operation.sealed, aad: operation.context.aad(offer: session.offer, direction: "sidebar-to-helper", sequence: operation.sequence))
        if operation.context.purpose == "read-edit" && (!value.isEmpty || session.readUsed) {
            value.resetBytes(in: 0..<value.count)
            throw CredentialFailure.replay
        }
        session.received = replay
        session.count += 1
        session.lastActivity = now()
        session.pending[operation.context.requestID] = operation
        if operation.context.purpose == "read-edit" { session.readUsed = true }
        return CredentialOpenedOperation(envelope: operation, owner: owner, value: value)
    }

    func respond(_ value: Data, operation: CredentialOpenedOperation) throws -> Data {
        let original = operation.envelope
        let session = try active(original.channelID, owner: operation.owner)
        guard original.context.expiresAtMilliseconds > now(),
              let pending = session.pending.removeValue(forKey: original.context.requestID),
              pending.snapshot == original.snapshot, pending.sealed == original.sealed
        else { throw CredentialFailure.ownerMismatch }
        let sequence = session.sequence
        session.sequence += 1
        session.count += 1
        let sealed = try CredentialCryptography.seal(key: session.sendKey, nonce: CredentialWire.nonce(sequence), value: value, aad: original.context.aad(offer: session.offer, direction: "helper-to-sidebar", sequence: sequence))
        session.lastActivity = now()
        var object = original.object
        object["sequence"] = sequence
        object["sealedPayload"] = sealed.base64EncodedString()
        return try JSONSerialization.data(withJSONObject: object, options: [.withoutEscapingSlashes])
    }

    func finish(_ operation: CredentialOpenedOperation) throws {
        let original = operation.envelope
        let session = try active(original.channelID, owner: operation.owner)
        guard original.context.expiresAtMilliseconds > now(),
              let pending = session.pending.removeValue(forKey: original.context.requestID),
              pending.snapshot == original.snapshot, pending.sealed == original.sealed
        else { throw CredentialFailure.ownerMismatch }
    }

    func beginDraft(_ data: Data, owner: CredentialChannelOwner, validateSource: @escaping @Sendable (CredentialSource?) async throws -> Void, cancelJob: @escaping @Sendable (String) async -> Void) async throws -> DraftCredentialReference {
        let envelope = try CredentialSealedOperation(JSONSerialization.jsonObject(with: data))
        try Self.validateSnapshot(envelope)
        let snapshot = try JSONSerialization.jsonObject(with: envelope.snapshot) as! [String: Any]
        let fingerprint = CredentialCryptography.digest(try JSONSerialization.data(withJSONObject: ["kind": envelope.context.kind, "endpoint": snapshot["endpoint"]!, "proxyMode": snapshot["proxyMode"]!], options: [.sortedKeys, .withoutEscapingSlashes]))
        guard fingerprint == envelope.context.endpointFingerprint else { throw CredentialFailure.ownerMismatch }
        guard ["draft-test", "draft-models"].contains(envelope.context.purpose), envelope.context.expiresAtMilliseconds > now(), envelope.context.expiresAtMilliseconds <= now() + 30_000 else { throw CredentialFailure.expired }
        let digest = CredentialCryptography.digest(try JSONSerialization.data(withJSONObject: envelope.object, options: [.sortedKeys, .withoutEscapingSlashes]))
        let key = draftKey(envelope.channelID, envelope.context.requestID)
        prune()
        if let existing = drafts[key] {
            guard existing.reference.owner == owner, existing.frameDigest == digest, existing.phase != "closed" else { throw CredentialFailure.replay }
            if existing.phase == "live" { return existing.reference }
            guard let task = existing.beginning else { throw CredentialFailure.channelUnavailable }
            let reference = try await task.value
            guard drafts[key] === existing, existing.phase == "live" else { throw CredentialFailure.ownerMismatch }
            return reference
        }
        guard drafts.count < 1_024 else { throw CredentialFailure.channelUnavailable }
        let reference = DraftCredentialReference(operationID: UUID().uuidString.lowercased(), channelID: envelope.channelID, requestID: envelope.context.requestID, owner: owner, purpose: envelope.context.purpose, snapshotDigest: envelope.context.snapshotDigest, deadlineMilliseconds: envelope.context.expiresAtMilliseconds)
        let draft = Draft(reference: reference, frameDigest: digest, envelope: envelope, cancelJob: cancelJob)
        drafts[key] = draft
        let delay = UInt64(max(1, reference.deadlineMilliseconds - now())) * 1_000_000
        draft.deadlineTask = Task { [weak self] in
            do { try await Task.sleep(nanoseconds: delay) } catch { return }
            await self?.expireDraft(reference)
        }
        let task = Task { [self] in
            var opened = try await self.decrypt(data, owner: owner, validateSource: validateSource)
            defer { opened.value.resetBytes(in: 0..<opened.value.count) }
            guard self.drafts[key] === draft, draft.phase == "preparing", reference.deadlineMilliseconds > self.now() else { throw CredentialFailure.ownerMismatch }
            try self.finish(opened)
            draft.value = opened.value
            draft.phase = "live"
            return reference
        }
        draft.beginning = task
        do {
            let result = try await task.value
            draft.beginning = nil
            guard draft.phase == "live" else { throw CredentialFailure.ownerMismatch }
            return result
        } catch {
            draft.beginning = nil
            closeDraft(draft)
            throw error
        }
    }

    func endDraft(_ reference: DraftCredentialReference, owner: CredentialChannelOwner) throws {
        let key = draftKey(reference.channelID, reference.requestID)
        guard reference.owner == owner, let draft = drafts[key], draft.reference == reference else { throw CredentialFailure.ownerMismatch }
        closeDraft(draft)
    }

    func cancelDraft(_ data: Data, owner: CredentialChannelOwner, cancelJob: @escaping @Sendable (String) async -> Void) throws {
        let envelope = try CredentialSealedOperation(JSONSerialization.jsonObject(with: data))
        try Self.validateSnapshot(envelope)
        guard ["draft-test", "draft-models"].contains(envelope.context.purpose) else { throw CredentialFailure.invalidMessage }
        _ = try active(envelope.channelID, owner: owner)
        let key = draftKey(envelope.channelID, envelope.context.requestID)
        let digest = CredentialCryptography.digest(try JSONSerialization.data(withJSONObject: envelope.object, options: [.sortedKeys, .withoutEscapingSlashes]))
        if let draft = drafts[key] {
            guard draft.reference.owner == owner, draft.frameDigest == digest else { throw CredentialFailure.ownerMismatch }
            closeDraft(draft)
        } else {
            guard drafts.count < 1_024, envelope.context.expiresAtMilliseconds > now(), envelope.context.expiresAtMilliseconds <= now() + 30_000 else { throw CredentialFailure.expired }
            let reference = DraftCredentialReference(operationID: UUID().uuidString.lowercased(), channelID: envelope.channelID, requestID: envelope.context.requestID, owner: owner, purpose: envelope.context.purpose, snapshotDigest: envelope.context.snapshotDigest, deadlineMilliseconds: envelope.context.expiresAtMilliseconds)
            let draft = Draft(reference: reference, frameDigest: digest, envelope: envelope, cancelJob: cancelJob)
            draft.phase = "closed"
            drafts[key] = draft
        }
    }

    func authorizeDraft(_ reference: DraftCredentialReference, input: CredentialHTTPRequest, includeValue: Bool, validateSource: @Sendable (CredentialSource?) async throws -> Void) async throws -> Data {
        let key = draftKey(reference.channelID, reference.requestID)
        guard let draft = drafts[key], draft.reference == reference, draft.phase == "live", reference.deadlineMilliseconds > now(), reference.owner.senderID == input.senderID, reference.requestID == input.requestID, reference.purpose == "draft-" + input.purpose else { throw CredentialFailure.ownerMismatch }
        _ = try active(reference.channelID, owner: reference.owner)
        let snapshot = try JSONSerialization.jsonObject(with: draft.envelope.snapshot) as! [String: Any]
        guard snapshot["kind"] as? String == input.kind, snapshot["endpoint"] as? String == input.endpoint, snapshot["model"] as? String == input.model, snapshot["proxyMode"] as? String == input.request.proxyMode else { throw CredentialFailure.ownerMismatch }
        draft.jobs.insert(input.request.jobID)
        try await validateSource(draft.envelope.context.source)
        guard drafts[key] === draft, draft.phase == "live", reference.deadlineMilliseconds > now() else { throw CredentialFailure.ownerMismatch }
        return includeValue ? draft.value : Data()
    }

    func finishDraftJob(_ reference: DraftCredentialReference, jobID: String) {
        drafts[draftKey(reference.channelID, reference.requestID)]?.jobs.remove(jobID)
    }

    private func draftKey(_ channelID: String, _ requestID: String) -> String { channelID + "\u{0}" + requestID }

    private func expireDraft(_ reference: DraftCredentialReference) {
        guard let draft = drafts[draftKey(reference.channelID, reference.requestID)], draft.reference == reference else { return }
        closeDraft(draft)
    }

    private func closeDraft(_ draft: Draft) {
        draft.phase = "closed"
        draft.beginning?.cancel()
        draft.value.resetBytes(in: 0..<draft.value.count)
        draft.value.removeAll()
        draft.deadlineTask?.cancel()
        draft.deadlineTask = nil
        let jobs = draft.jobs
        draft.jobs.removeAll()
        let cancelJob = draft.cancelJob
        Task { for job in jobs { await cancelJob(job) } }
    }

    func close(profileID: String) {
        let owners = sessions.values.filter { $0.offer.source?.profileID == profileID }.map { $0.offer.owner }
        for owner in owners { close(owner: owner) }
    }

    func close(senderID: String) {
        for draft in drafts.values where draft.reference.owner.senderID == senderID { closeDraft(draft) }
        registeredOwners.removeValue(forKey: senderID)
        generations[senderID, default: 0] += 1
        sessions = sessions.filter { $0.value.offer.owner.senderID != senderID }
    }

    func close(owner: CredentialChannelOwner, channelID: String? = nil) {
        guard registeredOwners[owner.senderID] == owner else { return }
        if let channelID, sessions[channelID]?.offer.owner != owner { return }
        close(senderID: owner.senderID)
    }

    func closeAll() {
        for draft in drafts.values { closeDraft(draft) }
        registeredOwners.removeAll()
        sessions.removeAll()
        for senderID in generations.keys { generations[senderID, default: 0] += 1 }
    }

    private func active(_ channelID: String, owner: CredentialChannelOwner) throws -> Session {
        prune()
        guard let session = sessions[channelID], session.offer.owner == owner else { throw CredentialFailure.ownerMismatch }
        guard session.count < CredentialWire.messageLimit, session.sequence < CredentialWire.messageLimit else {
            sessions.removeValue(forKey: channelID)
            throw CredentialFailure.expired
        }
        return session
    }

    private func prune() {
        let time = now()
        for draft in drafts.values where draft.reference.deadlineMilliseconds <= time { closeDraft(draft) }
        drafts = drafts.filter { $0.value.reference.deadlineMilliseconds > time }
        sessions = sessions.filter { time - $0.value.lastActivity < CredentialWire.idleMilliseconds }
        for session in sessions.values {
            session.pending = session.pending.filter { $0.value.context.expiresAtMilliseconds > time }
        }
    }

    nonisolated static func validateSnapshot(_ operation: CredentialSealedOperation) throws {
        guard CredentialCryptography.digest(operation.snapshot) == operation.context.snapshotDigest,
              String(data: operation.snapshot, encoding: .utf8) != nil
        else { throw CredentialFailure.authentication }
        let r = try CredentialWire.record(JSONSerialization.jsonObject(with: operation.snapshot), keys: ["kind", "endpoint", "model", "proxyMode", "purpose", "sourceProfile", "save"])
        guard r["kind"] as? String == operation.context.kind,
              r["purpose"] as? String == operation.context.purpose,
              let endpoint = r["endpoint"] as? String, endpoint.utf8.count <= 8_192,
              let url = URL(string: endpoint), ["http", "https"].contains(url.scheme ?? ""),
              let proxy = r["proxyMode"] as? String, ["system", "direct"].contains(proxy),
              r["model"] is NSNull || (r["model"] as? String).map({ $0.utf8.count <= 4_096 }) == true,
              try CredentialSource.optional(r["sourceProfile"]) == operation.context.source
        else { throw CredentialFailure.invalidMessage }
        if operation.context.purpose == "save-profile" {
            let save = try CredentialWire.record(r["save"] as Any, keys: ["commitId", "expectedStoreRevision", "expectedProfileRevision", "profileState"])
            _ = try CredentialWire.identity(save["commitId"])
            _ = try CredentialWire.integer(save["expectedStoreRevision"])
            if !(save["expectedProfileRevision"] is NSNull) { _ = try CredentialWire.integer(save["expectedProfileRevision"], minimum: 1) }
            let state = try CredentialWire.record(save["profileState"] as Any, keys: ["profiles", "activation"])
            guard let profiles = state["profiles"] as? [[String: Any]], profiles.count <= 1_024 else { throw CredentialFailure.invalidMessage }
            for profile in profiles {
                let allowed: Set<String> = ["profileId", "revision", "displayName", "kind", "endpoint", "endpointFingerprint", "proxyMode", "model", "capability"]
                guard Set(profile.keys).isSubset(of: allowed) else { throw CredentialFailure.invalidMessage }
            }
            if !(state["activation"] is NSNull) { _ = try CredentialWire.record(state["activation"] as Any, keys: ["profileId", "profileRevision", "kind", "endpointFingerprint", "credentialConfigured"]) }
            _ = try JSONDecoder().decode(StoredProfileState.self, from: JSONSerialization.data(withJSONObject: state))
        } else if !(r["save"] is NSNull) { throw CredentialFailure.invalidMessage }
    }
}
