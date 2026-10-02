import Foundation

func runCredentialWriteBoundaryTests() async throws {
    CredentialWriteObserver.shared.start()
    defer { _ = CredentialWriteObserver.shared.stop() }
    try await runSecureCredentialStoreTests()
    try await runCredentialMigrationTests()
    try await runCredentialRequestTests()
    try await runCredentialOperationTests()
    try await runFileRPCClientTests()
    let recorded = CredentialWriteObserver.shared.stop()
    try check(recorded.contains { $0.0.contains(".credentials-v2-") }, "observer must see production store staging writes before rename")
    try check(recorded.contains { $0.0.contains(".rpc/") && $0.0.hasSuffix(".tmp") }, "observer must see hidden RPC response staging writes before publication")
    let secrets = ["synthetic-migration-old-key", "synthetic-migration-new-key", "synthetic-key-秘密-atomic", "synthetic-protocol-save", "synthetic-inspection-key", "synthetic-operation-key", "synthetic-early-cancel-key", "synthetic-expired-key", "synthetic-other-window-key", "synthetic-closed-window-key", "synthetic-current-edit-key", "synthetic-renewed-key"] + ["openai", "claude", "deepseek", "ollama"].map { "synthetic-\($0)-credential" }
    for (_, bytes) in recorded {
        for secret in secrets {
            try check(bytes.range(of: Data(secret.utf8)) == nil, "production native write must not contain plaintext credential bytes")
            try CredentialResponseGuard.validate(body: bytes, headers: [], credential: Data(secret.utf8))
        }
    }
}
