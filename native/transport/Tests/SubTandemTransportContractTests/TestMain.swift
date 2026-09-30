import Darwin
import Foundation

struct ContractTestFailure: Error, CustomStringConvertible {
    let description: String
}

func check(_ condition: @autoclosure () -> Bool, _ message: String) throws {
    guard condition() else { throw ContractTestFailure(description: message) }
}

func expectFailure(_ message: String, _ operation: () throws -> Void) throws {
    do {
        try operation()
        throw ContractTestFailure(description: message)
    } catch is ContractTestFailure {
        throw ContractTestFailure(description: message)
    } catch {
        return
    }
}

@main
enum SubTandemTransportContractTestMain {
    static func main() async {
        do {
            if ProcessInfo.processInfo.environment["SUBTANDEM_NATIVE_TEST"] == "credential-store-worker" {
                try await runSecureStoreWorker()
                exit(EXIT_SUCCESS)
            }
            if ProcessInfo.processInfo.environment["SUBTANDEM_NATIVE_TEST"] == "credential-store" {
                try await runSecureCredentialStoreTests()
                print("Secure credential store tests passed")
                exit(EXIT_SUCCESS)
            }
            if ProcessInfo.processInfo.environment["SUBTANDEM_NATIVE_TEST"] == "credential-request" {
                try await runCredentialRequestTests()
                print("Credential request tests passed")
                exit(EXIT_SUCCESS)
            }
            try runCredentialChannelTests()
            try runCredentialProtectionTests()
            try runCredentialHostProbeTests()
            try await runCredentialChannelLifecycleTests()
            try await runSecureCredentialStoreTests()
            try await runCredentialRequestTests()
            try await runServerTests()
            try await runFileRPCClientTests()
            try await runHTTPClientTests()
            print("SubTandem transport contract tests passed")
            exit(EXIT_SUCCESS)
        } catch {
            fputs("SubTandem transport contract test failed: \(error)\n", stderr)
            exit(EXIT_FAILURE)
        }
    }
}
