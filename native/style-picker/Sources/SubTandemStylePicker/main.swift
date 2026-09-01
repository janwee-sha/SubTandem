import AppKit
import Darwin
import Foundation
import Security

private func secureToken() throws -> String {
    var bytes = [UInt8](repeating: 0, count: 32)
    guard SecRandomCopyBytes(kSecRandomDefault, bytes.count, &bytes) == errSecSuccess else {
        throw ProtocolError.invalid
    }
    return Data(bytes).base64EncodedString()
        .replacingOccurrences(of: "+", with: "-")
        .replacingOccurrences(of: "/", with: "_")
        .replacingOccurrences(of: "=", with: "")
}

private func parentPID(arguments: [String]) throws -> Int32? {
    guard arguments.first == "serve" else { throw ProtocolError.invalid }
    if arguments.count == 1 { return nil }
    guard arguments.count == 3,
          arguments[1] == "--parent-pid",
          let value = Int32(arguments[2]),
          value > 1 else { throw ProtocolError.invalid }
    return value
}

private func processRunning(_ pid: Int32) -> Bool {
    if kill(pid, 0) == 0 { return true }
    return errno == EPERM
}

@MainActor
private func run() throws {
    let observedParent = try parentPID(arguments: Array(CommandLine.arguments.dropFirst()))
    let application = NSApplication.shared
    application.setActivationPolicy(.accessory)
    let catalog = FontCatalog()
    let token = try secureToken()
    let server = StylePickerServer(token: token, catalog: catalog) {
        DispatchQueue.main.async {
            NSApplication.shared.terminate(nil)
        }
    }
    let port = try server.start()
    let ready = ReadyFrame(protocolVersion: 1, port: port, token: token)
    var output = try JSONEncoder().encode(ready)
    output.append(0x0a)
    FileHandle.standardOutput.write(output)

    let timer = DispatchSource.makeTimerSource(queue: .global(qos: .utility))
    timer.schedule(deadline: .now() + 1, repeating: 1)
    timer.setEventHandler {
        guard ParentExitRule.shouldExit(parentPID: observedParent, isRunning: processRunning) else {
            return
        }
        server.stop()
        DispatchQueue.main.async {
            application.terminate(nil)
        }
    }
    timer.resume()
    application.run()
    timer.cancel()
    server.stop()
}

do {
    try run()
} catch {
    exit(1)
}
