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

private func processRunning(_ pid: Int32) -> Bool {
    if kill(pid, 0) == 0 { return true }
    return errno == EPERM
}

@MainActor
private func run() throws {
    let arguments = Array(CommandLine.arguments.dropFirst())
    let startup = try PickerArguments.parse(arguments)
    if startup.mode == .launch {
        try DetachedBootstrap.launch(arguments: Array(arguments.dropFirst()), readyFile: startup.readyFile)
        return
    }
    guard let observedParent = startup.parentPID else { throw ProtocolError.invalid }
    let readyFile = startup.readyFile
    let localizer = try NativeLocalizer(locale: startup.uiLocale)
    let application = NSApplication.shared
    application.setActivationPolicy(.accessory)
    let catalog = FontCatalog(locale: startup.uiLocale.rawValue)
    let token = try secureToken()
    let server = StylePickerServer(token: token, catalog: catalog, localizer: localizer) {
        DispatchQueue.main.async {
            NSApplication.shared.terminate(nil)
        }
    }
    let port = try server.start()
    try ReadyFileWriter.write(ReadyFrame(port: port, token: token, uiLocale: startup.uiLocale), to: readyFile)

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
