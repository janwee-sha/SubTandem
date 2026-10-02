import CryptoKit
import Foundation

struct SyntheticAgreementKey: CredentialAgreementKey {
    let key: P256.KeyAgreement.PrivateKey
    var representation: Data { key.rawRepresentation }
    var publicKey: Data { key.publicKey.x963Representation }
    func sharedSecret(with peer: Data) throws -> SharedSecret {
        try key.sharedSecretFromKeyAgreement(with: P256.KeyAgreement.PublicKey(x963Representation: peer))
    }
}
struct SyntheticKeyBackend: CredentialKeyBackend {
    func create() throws -> any CredentialAgreementKey { SyntheticAgreementKey(key: P256.KeyAgreement.PrivateKey()) }
    func restore(_ representation: Data) throws -> any CredentialAgreementKey { SyntheticAgreementKey(key: try P256.KeyAgreement.PrivateKey(rawRepresentation: representation)) }
}
struct DeniedKeyBackend: CredentialKeyBackend {
    func create() throws -> any CredentialAgreementKey { throw CredentialFailure.hardwareUnavailable }
    func restore(_ representation: Data) throws -> any CredentialAgreementKey { throw CredentialFailure.hardwareUnavailable }
}

func runCredentialProtectionTests() throws {
    try check(SecureEnclaveCredentialBackend.authenticationContext().interactionNotAllowed, "hardware access must prohibit interaction")
    let protection = CredentialProtection(backend: SyntheticKeyBackend())
    let slot = try protection.makeKeySlot()
    let key = Data("synthetic-encryption-only-雪".utf8)
    let first = try protection.seal(key, storeID: "store-a", profileID: "profile-a", slot: slot)
    let second = try protection.seal(key, storeID: "store-a", profileID: "profile-a", slot: slot)
    try check(first.credentialID != second.credentialID && first.envelope != second.envelope, "each envelope must have fresh identity and encryption randomness")
    let open = try protection.open(first, storeID: "store-a", profileID: "profile-a", slots: [slot.keyID: slot])
    try check(open == key, "production protection must recover the synthetic key")
    for (storeID, profileID) in [("store-b", "profile-a"), ("store-a", "profile-b")] {
        try expectFailure("index context swapping must fail") { _ = try protection.open(first, storeID: storeID, profileID: profileID, slots: [slot.keyID: slot]) }
    }
    let restored = CredentialProtection(backend: SyntheticKeyBackend())
    let afterRestore = try restored.seal(key, storeID: "store-a", profileID: "profile-a", slot: slot)
    try check(afterRestore.credentialID != first.credentialID && afterRestore.envelope != first.envelope, "restoring a snapshot must not restore a nonce counter")
    try expectFailure("missing slot must fail") { _ = try protection.open(first, storeID: "store-a", profileID: "profile-a", slots: [:]) }
    try expectFailure("hardware denial must not fall back") { _ = try CredentialProtection(backend: DeniedKeyBackend()).makeKeySlot() }
    try expectFailure("hardware denial must reject reads") { _ = try CredentialProtection(backend: DeniedKeyBackend()).open(first, storeID: "store-a", profileID: "profile-a", slots: [slot.keyID: slot]) }
    try expectFailure("oversized input must fail") { _ = try protection.seal(Data(repeating: 65, count: 8193), storeID: "store-a", profileID: "profile-a", slot: slot) }
}
