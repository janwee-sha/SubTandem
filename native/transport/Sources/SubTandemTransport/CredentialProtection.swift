import CryptoKit
import Foundation
import LocalAuthentication
import Security

protocol CredentialAgreementKey: Sendable {
    var representation: Data { get }
    var publicKey: Data { get }
    func sharedSecret(with peer: Data) throws -> SharedSecret
}
protocol CredentialKeyBackend: Sendable {
    func create() throws -> any CredentialAgreementKey
    func restore(_ representation: Data) throws -> any CredentialAgreementKey
}
struct SecureEnclaveAgreementKey: CredentialAgreementKey {
    let key: SecureEnclave.P256.KeyAgreement.PrivateKey
    var representation: Data { key.dataRepresentation }
    var publicKey: Data { key.publicKey.x963Representation }
    func sharedSecret(with peer: Data) throws -> SharedSecret {
        guard peer.count == 65, peer.first == 4 else { throw CredentialFailure.invalidMessage }
        return try key.sharedSecretFromKeyAgreement(with: P256.KeyAgreement.PublicKey(x963Representation: peer))
    }
}
struct SecureEnclaveCredentialBackend: CredentialKeyBackend {
    static func authenticationContext() -> LAContext {
        let context = LAContext()
        context.interactionNotAllowed = true
        return context
    }
    func create() throws -> any CredentialAgreementKey {
        guard SecureEnclave.isAvailable,
              let access = SecAccessControlCreateWithFlags(nil, kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly, [], nil)
        else { throw CredentialFailure.hardwareUnavailable }
        do {
            return SecureEnclaveAgreementKey(key: try SecureEnclave.P256.KeyAgreement.PrivateKey(
                compactRepresentable: false, accessControl: access,
                authenticationContext: Self.authenticationContext()
            ))
        } catch { throw CredentialFailure.hardwareUnavailable }
    }
    func restore(_ representation: Data) throws -> any CredentialAgreementKey {
        guard SecureEnclave.isAvailable, !representation.isEmpty, representation.count <= 16_384
        else { throw CredentialFailure.hardwareUnavailable }
        do {
            return SecureEnclaveAgreementKey(key: try SecureEnclave.P256.KeyAgreement.PrivateKey(
                dataRepresentation: representation, authenticationContext: Self.authenticationContext()
            ))
        } catch { throw CredentialFailure.hardwareUnavailable }
    }
}
struct CredentialDeviceKeySlot: Codable, Equatable, Sendable {
    let keyID: String
    let wrappedRepresentation: String
    enum CodingKeys: String, CodingKey {
        case keyID = "keyId"
        case wrappedRepresentation
    }
}
struct CredentialStoredValue: Codable, Equatable, Sendable {
    let credentialID: String
    let envelope: String
    enum CodingKeys: String, CodingKey {
        case credentialID = "credentialId"
        case envelope
    }
}
struct CredentialProtection: Sendable {
    private let backend: any CredentialKeyBackend
    init(backend: any CredentialKeyBackend = SecureEnclaveCredentialBackend()) { self.backend = backend }

    func makeKeySlot() throws -> CredentialDeviceKeySlot {
        let key = try backend.create()
        guard !key.representation.isEmpty, key.representation.count <= 16_384 else { throw CredentialFailure.hardwareUnavailable }
        return CredentialDeviceKeySlot(keyID: UUID().uuidString.lowercased(), wrappedRepresentation: key.representation.base64EncodedString())
    }

    func seal(_ value: Data, storeID: String, profileID: String, slot: CredentialDeviceKeySlot) throws -> CredentialStoredValue {
        guard value.count <= CredentialWire.keyBytes, String(data: value, encoding: .utf8) != nil else { throw CredentialFailure.tooLarge }
        let deviceKey = try backend.restore(CredentialWire.base64(slot.wrappedRepresentation, maximum: 16_384))
        let ephemeral = P256.KeyAgreement.PrivateKey(compactRepresentable: false)
        let credentialID = UUID().uuidString.lowercased()
        let salt = try SecureRandom.bytes(count: 32)
        let nonce = try SecureRandom.bytes(count: 12)
        let aad = try context(storeID: storeID, profileID: profileID, credentialID: credentialID, keyID: slot.keyID)
        let secret = try ephemeral.sharedSecretFromKeyAgreement(with: P256.KeyAgreement.PublicKey(x963Representation: deviceKey.publicKey))
        let key = secret.hkdfDerivedSymmetricKey(using: SHA256.self, salt: salt, sharedInfo: aad, outputByteCount: 32)
        let box = try AES.GCM.seal(value, using: key, nonce: AES.GCM.Nonce(data: nonce), authenticating: aad)
        let envelope: [String: Any] = [
            "version": 1, "algorithm": "P256-HKDF-SHA256-AES256GCM", "keyId": slot.keyID,
            "ephemeralPublicKey": ephemeral.publicKey.x963Representation.base64EncodedString(),
            "salt": salt.base64EncodedString(), "nonce": nonce.base64EncodedString(),
            "ciphertext": box.ciphertext.base64EncodedString(), "tag": box.tag.base64EncodedString(),
        ]
        let bytes = try JSONSerialization.data(withJSONObject: envelope, options: [.sortedKeys, .withoutEscapingSlashes])
        return CredentialStoredValue(credentialID: credentialID, envelope: bytes.base64EncodedString())
    }

    func open(_ value: CredentialStoredValue, storeID: String, profileID: String, slots: [String: CredentialDeviceKeySlot]) throws -> Data {
        do {
            let bytes = try CredentialWire.base64(value.envelope, maximum: CredentialWire.sealedBytes)
            let envelope = try CredentialWire.record(JSONSerialization.jsonObject(with: bytes), keys: ["version", "algorithm", "keyId", "ephemeralPublicKey", "salt", "nonce", "ciphertext", "tag"])
            guard try CredentialWire.integer(envelope["version"]) == 1,
                  envelope["algorithm"] as? String == "P256-HKDF-SHA256-AES256GCM",
                  let keyID = envelope["keyId"] as? String, let slot = slots[keyID], slot.keyID == keyID
            else { throw CredentialFailure.unavailable }
            let deviceKey = try backend.restore(CredentialWire.base64(slot.wrappedRepresentation, maximum: 16_384))
            let peer = try CredentialWire.base64(envelope["ephemeralPublicKey"], maximum: 65, exact: 65)
            guard peer.first == 4 else { throw CredentialFailure.invalidMessage }
            let salt = try CredentialWire.base64(envelope["salt"], maximum: 32, exact: 32)
            let nonce = try CredentialWire.base64(envelope["nonce"], maximum: 12, exact: 12)
            let ciphertext = try CredentialWire.base64(envelope["ciphertext"], maximum: CredentialWire.keyBytes)
            let tag = try CredentialWire.base64(envelope["tag"], maximum: 16, exact: 16)
            let aad = try context(storeID: storeID, profileID: profileID, credentialID: value.credentialID, keyID: keyID)
            let secret = try deviceKey.sharedSecret(with: peer)
            let key = secret.hkdfDerivedSymmetricKey(using: SHA256.self, salt: salt, sharedInfo: aad, outputByteCount: 32)
            let box = try AES.GCM.SealedBox(nonce: AES.GCM.Nonce(data: nonce), ciphertext: ciphertext, tag: tag)
            let plaintext = try AES.GCM.open(box, using: key, authenticating: aad)
            guard String(data: plaintext, encoding: .utf8) != nil else { throw CredentialFailure.unavailable }
            return plaintext
        } catch { throw CredentialFailure.unavailable }
    }

    private func context(storeID: String, profileID: String, credentialID: String, keyID: String) throws -> Data {
        _ = try CredentialWire.identity(storeID)
        _ = try CredentialWire.identity(profileID)
        _ = try CredentialWire.identity(credentialID)
        _ = try CredentialWire.identity(keyID)
        return try CredentialWire.array(["subtandem-credential", 2, 1, storeID, profileID, credentialID, keyID, "apiKey"])
    }
}
