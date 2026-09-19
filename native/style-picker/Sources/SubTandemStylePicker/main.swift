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

private func serveArguments(_ arguments: [String]) throws -> (URL, Int32) {
    guard arguments.count == 5,
          arguments[0] == "serve",
          arguments[1] == "--ready-file",
          arguments[3] == "--parent-pid",
          let value = Int32(arguments[4]),
          value > 1 else { throw ProtocolError.invalid }
    let readyFile = URL(fileURLWithPath: arguments[2]).standardizedFileURL
    guard readyFile.path.hasPrefix("/"),
          readyFile.deletingLastPathComponent().lastPathComponent == ".ready",
          readyFile.lastPathComponent.hasPrefix("style-picker-"),
          readyFile.pathExtension == "json"
    else { throw ProtocolError.invalid }
    return (readyFile, value)
}

private func processRunning(_ pid: Int32) -> Bool {
    if kill(pid, 0) == 0 { return true }
    return errno == EPERM
}

@MainActor
private func run() throws {
    let arguments = Array(CommandLine.arguments.dropFirst())
    if arguments.count == 3,
       arguments[0] == "launch",
       arguments[1] == "--ready-file" {
        let readyFile = URL(fileURLWithPath: arguments[2]).standardizedFileURL
        try DetachedBootstrap.launch(
            arguments: Array(arguments[1...2]),
            readyFile: readyFile
        )
        return
    }
    let (readyFile, observedParent) = try serveArguments(arguments)
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
    try ReadyFileWriter.write(ReadyFrame(port: port, token: token), to: readyFile)

    let timer = makeParentProcessMonitor(
        parentPID: observedParent,
        deadline: .now() + 1,
        repeating: .seconds(1),
        isRunning: processRunning,
        onExit: {
            server.stop()
            Task { @MainActor in
                NSApplication.shared.terminate(nil)
            }
        }
    )
    application.run()
    timer.cancel()
    server.stop()
}

do {
    try run()
} catch {
    exit(1)
}
