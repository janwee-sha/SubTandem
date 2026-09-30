import Foundation

func runCredentialHostProbeTests() throws {
    let root = FileManager.default.temporaryDirectory.appendingPathComponent("subtandem-probe-test-\(UUID().uuidString)")
    try FileManager.default.createDirectory(at: root, withIntermediateDirectories: false)
    defer { try? FileManager.default.removeItem(at: root) }
    let protection = CredentialProtection(backend: SyntheticKeyBackend())
    let expected = Data("SubTandem-credential-probe-20260930".utf8)
    let path = root.appendingPathComponent("credential-host-probe/protected-sample.json")
    let created = try CredentialHostProbe.runSample(action: "create", dataDirectory: root, protection: protection)
    try check(created == expected, "host probe must create and recover its synthetic sample")
    let first = try Data(contentsOf: path)
    try check(first.range(of: expected) == nil, "host probe must persist no plaintext")
    let recovered = try CredentialHostProbe.runSample(action: "recover", dataDirectory: root, protection: protection)
    try check(recovered == expected, "host probe must recover when its directory already exists")
    let unchanged = try Data(contentsOf: path)
    try check(first == unchanged, "recovery must not replace the sample")
    let replaced = try CredentialHostProbe.runSample(action: "replace", dataDirectory: root, protection: protection)
    let second = try Data(contentsOf: path)
    try check(replaced == expected && second != first, "replacement must produce a fresh protected sample")
    let removed = try CredentialHostProbe.runSample(action: "remove", dataDirectory: root, protection: CredentialProtection(backend: DeniedKeyBackend()))
    try check(removed.isEmpty && !FileManager.default.fileExists(atPath: path.deletingLastPathComponent().path), "removal must clean the sample without accessing hardware")
}
