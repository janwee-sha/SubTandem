import Foundation

struct StylePickerTestFailure: Error {
    let message: String
}

func check(_ condition: @autoclosure () -> Bool, _ message: String) throws {
    if !condition() { throw StylePickerTestFailure(message: message) }
}

func checkThrows(_ message: String, _ operation: () throws -> Void) throws {
    do {
        try operation()
    } catch {
        return
    }
    throw StylePickerTestFailure(message: message)
}

func runProtocolTests() throws {
    let frame = ReadyFrame(port: 49_152, token: "opaque-token", createdAtMs: 10_000)
    let object = try JSONSerialization.jsonObject(with: JSONEncoder().encode(frame)) as? [String: Any]
    try check(
        Set(object?.keys.map { $0 } ?? []) == Set(["type", "protocolVersion", "port", "token", "createdAtMs"]),
        "ready keys"
    )
    try check(object?["type"] as? String == "ready", "ready type")
    try check(object?["protocolVersion"] as? Int == 1, "ready version")
    try check(object?["port"] as? Int == 49_152, "ready port")
    try check(object?["token"] as? String == "opaque-token", "ready token")
    try check(object?["createdAtMs"] as? Int == 10_000, "ready freshness")
    let daemonArguments = try DetachedBootstrap.daemonArguments(
        ["--ready-file", "/private/.ready/style-picker-test.json"],
        parentPID: 123
    )
    try check(
        daemonArguments == [
            "serve", "--ready-file", "/private/.ready/style-picker-test.json", "--parent-pid", "123",
        ],
        "bootstrap must pass the real parent PID to serve mode"
    )
    try checkThrows("bootstrap must reject init as parent") {
        _ = try DetachedBootstrap.daemonArguments([], parentPID: 1)
    }

    let readyRoot = FileManager.default.temporaryDirectory
        .appendingPathComponent("subtandem-style-ready-\(UUID().uuidString)", isDirectory: true)
    let readyFile = readyRoot
        .appendingPathComponent(".ready", isDirectory: true)
        .appendingPathComponent("style-picker-test.json")
    defer { try? FileManager.default.removeItem(at: readyRoot) }
    try ReadyFileWriter.write(frame, to: readyFile)
    let directoryMode = try FileManager.default.attributesOfItem(
        atPath: readyFile.deletingLastPathComponent().path
    )[.posixPermissions] as? NSNumber
    let fileMode = try FileManager.default.attributesOfItem(
        atPath: readyFile.path
    )[.posixPermissions] as? NSNumber
    try check(directoryMode?.intValue == 0o700, "ready directory permissions")
    try check(fileMode?.intValue == 0o600, "ready file permissions")

    try check(ProtocolValidator.authorized(headers: ["authorization": "Bearer secret"], token: "secret"), "authorization")
    try check(!ProtocolValidator.authorized(headers: [:], token: "secret"), "missing authorization")
    try check(!ProtocolValidator.authorized(headers: ["authorization": "Bearer other"], token: "secret"), "wrong authorization")

    let valid = Data(#"{"requestId":"picker.1","fontFamily":null,"fontSize":40,"bold":false,"italic":false}"#.utf8)
    _ = try ProtocolValidator.decodeFontOpen(valid)
    let unknown = Data(#"{"requestId":"picker.1","fontFamily":null,"fontSize":40,"bold":false,"italic":false,"text":"body"}"#.utf8)
    try checkThrows("unknown font field") { _ = try ProtocolValidator.decodeFontOpen(unknown) }
    let invalidFamily = Data("{\"requestId\":\"picker.1\",\"fontFamily\":\"bad\\u0000body\",\"fontSize\":40,\"bold\":false,\"italic\":false}".utf8)
    try checkThrows("invalid font family") { _ = try ProtocolValidator.decodeFontOpen(invalidFamily) }

    let store = PickerEventStore(capacity: 2)
    store.append(requestId: "picker.1", payload: .fontCancelled)
    store.append(requestId: "picker.2", payload: .fontConfirmed("Inter"))
    store.append(requestId: "picker.3", payload: .pickerFailed("PICKER_UNAVAILABLE"))
    try check(store.events(after: 1).events.map(\.revision) == [2, 3], "ordered events")
    try check(store.events(after: 0).gap, "event gap")
    try check(store.events(after: 3).events == [], "empty latest events")

    let lifecycle = PickerLifecycle()
    try check(lifecycle.open(requestId: "picker.1"), "picker open")
    try check(!lifecycle.open(requestId: "picker.2"), "picker busy")
    try check(lifecycle.activate(requestId: "picker.1"), "active picker activation")
    try check(!lifecycle.activate(requestId: "picker.2"), "foreign picker activation")
    try check(!lifecycle.cancel(requestId: "picker.2"), "foreign cancel")
    try check(lifecycle.cancel(requestId: "picker.1"), "active cancel")
    try check(!lifecycle.cancel(requestId: "picker.1"), "duplicate cancel")
    lifecycle.shutdown()
    lifecycle.shutdown()
    try check(lifecycle.shuttingDown, "shutdown")
}

@main
struct StylePickerTestMain {
    static func main() throws {
        try runProtocolTests()
        try runFontPickerTests()
        try runColorPickerTests()
    }
}
