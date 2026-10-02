import Foundation

func credentialCheck(_ condition: @autoclosure () throws -> Bool, _ message: String) throws {
    let result = try condition()
    try check(result, message)
}

func credentialVectorFixture() throws -> [String: Any] {
    let url = URL(fileURLWithPath: FileManager.default.currentDirectoryPath)
        .appendingPathComponent("tests/fixtures/credentials/channel-vectors.json")
    return try JSONSerialization.jsonObject(with: Data(contentsOf: url)) as! [String: Any]
}

func runCredentialChannelTests() throws {
    var replay = CredentialSequenceState()
    try replay.accept(2)
    try replay.accept(1)
    try expectFailure("replay must fail") { try replay.accept(1) }
    try replay.accept(200)
    try expectFailure("outside receive window must fail") { try replay.accept(3) }
    try expectFailure("message limit must fail") { try replay.accept(4096) }
    let fixture = try credentialVectorFixture()
    let offerJSON = fixture["offer"] as! [String: Any]
    let context = try CredentialContext(fixture["context"]!)
    let source = try CredentialSource.optional(offerJSON["sourceProfile"])
    let offer = CredentialChannelOffer(
        owner: CredentialChannelOwner(sidebarInstanceID: "sidebar-vector", senderID: "window-vector", drawerID: "drawer-vector"),
        helperSessionID: "helper-vector", channelID: "channel-vector", source: source,
        clientPublicKey: try CredentialWire.base64(offerJSON["clientPublicKey"], maximum: 65, exact: 65),
        helperPublicKey: try CredentialWire.base64(offerJSON["helperPublicKey"], maximum: 65, exact: 65),
        salt: try CredentialWire.base64(offerJSON["salt"], maximum: 32, exact: 32)
    )
    let decode: (Any?) throws -> Data = { try CredentialWire.base64($0, maximum: 32_768) }
    for vector in fixture["vectors"] as! [[String: Any]] {
        let direction = vector["direction"] as! String
        let info = try offer.keyInfo(direction)
        try credentialCheck(info == decode(vector["info"]), "cross-language HKDF info mismatch")
        let key = try CredentialCryptography.derive(privateKey: decode(fixture["helperPrivateKey"]), publicKey: offer.clientPublicKey, salt: offer.salt, info: info)
        try credentialCheck(key == decode(vector["key"]), "CryptoKit ECDH/HKDF must match the public vector")
        let aad = try context.aad(offer: offer, direction: direction, sequence: 1)
        try credentialCheck(aad == decode(vector["aad"]), "cross-language operation AAD mismatch")
        let value = try decode(vector["plaintext"])
        let sealed = try CredentialCryptography.seal(key: key, nonce: CredentialWire.nonce(1), value: value, aad: aad)
        try credentialCheck(sealed == decode(vector["sealed"]), "CryptoKit AES-GCM must match noble")
        let opened = try CredentialCryptography.open(key: key, nonce: CredentialWire.nonce(1), sealed: sealed, aad: aad)
        try credentialCheck(opened == value, "CryptoKit must open the peer vector")
        let handshakeAAD = try offer.handshakeAAD(direction)
        try credentialCheck(handshakeAAD == decode(vector["handshakeAAD"]), "handshake transcript encoding mismatch")
        let confirmation = try CredentialCryptography.seal(key: key, nonce: CredentialWire.nonce(0), value: Data(), aad: handshakeAAD)
        try credentialCheck(confirmation == decode(vector["handshakeSealed"]), "handshake confirmation mismatch")
        var damaged = sealed
        damaged[damaged.count - 1] ^= 1
        try expectFailure("damaged tag must fail") { _ = try CredentialCryptography.open(key: key, nonce: CredentialWire.nonce(1), sealed: damaged, aad: aad) }
        try expectFailure("wrong AAD must fail") { _ = try CredentialCryptography.open(key: key, nonce: CredentialWire.nonce(1), sealed: sealed, aad: Data("wrong".utf8)) }
    }
    try credentialCheck(CredentialCryptography.digest(decode(fixture["snapshotBytes"])) == context.snapshotDigest, "snapshot digest must hash exact bytes")
    for bad in ["AB==", "AA", "AAA=\n", "AA-_", "A==="] {
        try expectFailure("noncanonical base64 must fail") { _ = try CredentialWire.base64(bad, maximum: 128) }
    }
    try expectFailure("invalid point must fail") {
        _ = try CredentialCryptography.derive(privateKey: decode(fixture["clientPrivateKey"]), publicKey: Data(repeating: 0, count: 65), salt: offer.salt, info: Data())
    }
}

final class CredentialTestClock: @unchecked Sendable {
    var value: Int64 = 1_899_999_999_000
}

func expectCredentialAsyncFailure(_ message: String, _ operation: () async throws -> Void) async throws {
    do {
        try await operation()
    } catch is ContractTestFailure {
        throw ContractTestFailure(description: message)
    } catch { return }
    throw ContractTestFailure(description: message)
}

func runCredentialChannelLifecycleTests() async throws {
    let fixture = try credentialVectorFixture()
    let vectorOffer = fixture["offer"] as! [String: Any]
    let clientPrivate = try CredentialWire.base64(fixture["clientPrivateKey"], maximum: 32, exact: 32)
    let clock = CredentialTestClock()
    let manager = CredentialChannelManager(helperSessionID: "lifecycle-helper", now: { clock.value })
    let owner = CredentialChannelOwner(sidebarInstanceID: "sidebar-vector", senderID: "window-vector", drawerID: "drawer-vector")
    let openRequest = try JSONSerialization.data(withJSONObject: ["protocolVersion": 2, "sidebarInstanceId": owner.sidebarInstanceID, "drawerId": owner.drawerID, "sourceProfile": vectorOffer["sourceProfile"]!, "clientPublicKey": vectorOffer["clientPublicKey"]!])
    let offerData = try await manager.open(openRequest, senderID: owner.senderID, validateSource: { _ in })
    let raw = try JSONSerialization.jsonObject(with: offerData) as! [String: Any]
    let offer = CredentialChannelOffer(owner: owner, helperSessionID: "lifecycle-helper", channelID: raw["channelId"] as! String, source: try CredentialSource.optional(raw["sourceProfile"]), clientPublicKey: try CredentialWire.base64(raw["clientPublicKey"], maximum: 65), helperPublicKey: try CredentialWire.base64(raw["helperPublicKey"], maximum: 65), salt: try CredentialWire.base64(raw["salt"], maximum: 32))
    let sendKey = try CredentialCryptography.derive(privateKey: clientPrivate, publicKey: offer.helperPublicKey, salt: offer.salt, info: offer.keyInfo("sidebar-to-helper"))
    let receiveKey = try CredentialCryptography.derive(privateKey: clientPrivate, publicKey: offer.helperPublicKey, salt: offer.salt, info: offer.keyInfo("helper-to-sidebar"))
    let confirmation = try CredentialCryptography.seal(key: sendKey, nonce: CredentialWire.nonce(0), value: Data(), aad: offer.handshakeAAD("sidebar-to-helper"))
    let confirmRequest = try JSONSerialization.data(withJSONObject: ["protocolVersion": 2, "channelId": offer.channelID, "helperSessionId": offer.helperSessionID, "sequence": 0, "sealedPayload": confirmation.base64EncodedString()])
    let confirmed = try await manager.confirm(confirmRequest, owner: owner)
    let confirmedObject = try JSONSerialization.jsonObject(with: confirmed) as! [String: Any]
    let acknowledgement = try CredentialCryptography.open(key: receiveKey, nonce: CredentialWire.nonce(0), sealed: CredentialWire.base64(confirmedObject["sealedPayload"], maximum: 16), aad: offer.handshakeAAD("helper-to-sidebar"))
    try check(acknowledgement.isEmpty, "helper must authenticate its handshake response")
    let context = try CredentialContext(fixture["context"]!)
    let plaintext = Data("synthetic-lifecycle-only".utf8)
    let sealed = try CredentialCryptography.seal(key: sendKey, nonce: CredentialWire.nonce(1), value: plaintext, aad: context.aad(offer: offer, direction: "sidebar-to-helper", sequence: 1))
    let request = try JSONSerialization.data(withJSONObject: ["protocolVersion": 2, "channelId": offer.channelID, "helperSessionId": offer.helperSessionID, "sequence": 1, "context": context.object, "snapshotBytes": fixture["snapshotBytes"]!, "sealedPayload": sealed.base64EncodedString()])
    let opened = try await manager.decrypt(request, owner: owner, validateSource: { _ in })
    try check(opened.value == plaintext, "manager must decrypt only after authenticated ownership and snapshot validation")
    try await expectCredentialAsyncFailure("replay must fail") { _ = try await manager.decrypt(request, owner: owner, validateSource: { _ in }) }
    let response = try await manager.respond(plaintext, operation: opened)
    let responseFrame = try CredentialSealedOperation(JSONSerialization.jsonObject(with: response))
    let responseValue = try CredentialCryptography.open(key: receiveKey, nonce: CredentialWire.nonce(responseFrame.sequence), sealed: responseFrame.sealed, aad: context.aad(offer: offer, direction: "helper-to-sidebar", sequence: responseFrame.sequence))
    try check(responseValue == plaintext, "response must use the independent reverse-direction key")
    try await expectCredentialAsyncFailure("second response must fail") { _ = try await manager.respond(plaintext, operation: opened) }
    clock.value += CredentialWire.idleMilliseconds
    try await expectCredentialAsyncFailure("expired session must fail") { _ = try await manager.decrypt(request, owner: owner, validateSource: { _ in }) }
    let restarted = CredentialChannelManager()
    try await expectCredentialAsyncFailure("restart must invalidate old channels") { _ = try await restarted.decrypt(request, owner: owner, validateSource: { _ in }) }
    _ = try await manager.open(openRequest, senderID: owner.senderID, validateSource: { _ in })
    await manager.close(senderID: owner.senderID)
    try await expectCredentialAsyncFailure("closed owner must fail") { _ = try await manager.confirm(confirmRequest, owner: owner) }
    let nextOwner = CredentialChannelOwner(sidebarInstanceID: owner.sidebarInstanceID, senderID: owner.senderID, drawerID: "next-drawer")
    var nextOpen = try JSONSerialization.jsonObject(with: openRequest) as! [String: Any]
    nextOpen["drawerId"] = nextOwner.drawerID
    let nextData = try await manager.open(JSONSerialization.data(withJSONObject: nextOpen), senderID: owner.senderID, validateSource: { _ in })
    let nextRaw = try JSONSerialization.jsonObject(with: nextData) as! [String: Any]
    let nextOffer = CredentialChannelOffer(owner: nextOwner, helperSessionID: "lifecycle-helper", channelID: nextRaw["channelId"] as! String, source: offer.source, clientPublicKey: offer.clientPublicKey, helperPublicKey: try CredentialWire.base64(nextRaw["helperPublicKey"], maximum: 65), salt: try CredentialWire.base64(nextRaw["salt"], maximum: 32))
    let nextKey = try CredentialCryptography.derive(privateKey: clientPrivate, publicKey: nextOffer.helperPublicKey, salt: nextOffer.salt, info: nextOffer.keyInfo("sidebar-to-helper"))
    let nextTag = try CredentialCryptography.seal(key: nextKey, nonce: CredentialWire.nonce(0), value: Data(), aad: nextOffer.handshakeAAD("sidebar-to-helper"))
    await manager.close(owner: owner)
    let nextConfirmation = try JSONSerialization.data(withJSONObject: ["protocolVersion": 2, "channelId": nextOffer.channelID, "helperSessionId": nextOffer.helperSessionID, "sequence": 0, "sealedPayload": nextTag.base64EncodedString()])
    _ = try await manager.confirm(nextConfirmation, owner: nextOwner)

}
