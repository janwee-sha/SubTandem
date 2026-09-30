import Foundation
import Darwin

final class CredentialWriteObserver: @unchecked Sendable {
    static let shared = CredentialWriteObserver()
    private let lock = NSLock()
    private var recorded: [(String, Data)] = []
    private var enabled = false
    #if SUBTANDEM_CREDENTIAL_OBSERVER_HOST
    private var hostFile: URL?
    private var sequence = 0
    private let hostSecrets = ["openai", "claude", "deepseek", "ollama"].map { "synthetic-host-\($0)-key" }
    init() {
        let args = CommandLine.arguments
        if args.count == 10, args[1] == "serve", args[2] == "--data-directory" {
            hostFile = URL(fileURLWithPath: args[3]).appendingPathComponent("credential-write-observer-native.jsonl")
            enabled = true
        }
    }
    #endif
    func start() { lock.withLock { recorded.removeAll(); enabled = true } }
    func stop() -> [(String, Data)] { lock.withLock { enabled = false; return recorded } }
    func capture(path: String, bytes: Data) {
        lock.withLock {
            guard enabled else { return }
            #if SUBTANDEM_CREDENTIAL_OBSERVER_HOST
            if let hostFile {
                sequence += 1
                let matches = hostSecrets.filter { secret in
                    do { try CredentialResponseGuard.validate(body: bytes, headers: [], credential: Data(secret.utf8)); return false }
                    catch { return true }
                }.count
                let record: [String: Any] = ["point": "before-write", "sequence": sequence, "file": URL(fileURLWithPath: path).lastPathComponent, "bytes": bytes.count, "secretMatches": matches]
                guard var data = try? JSONSerialization.data(withJSONObject: record, options: [.sortedKeys]) else { return }
                data.append(10)
                let descriptor = open(hostFile.path, O_WRONLY | O_CREAT | O_APPEND | O_NOFOLLOW, S_IRUSR | S_IWUSR)
                guard descriptor >= 0 else { return }
                defer { close(descriptor) }
                _ = data.withUnsafeBytes { Darwin.write(descriptor, $0.baseAddress, data.count) }
                _ = fsync(descriptor)
                return
            }
            #endif
            recorded.append((path, bytes))
        }
    }
}
