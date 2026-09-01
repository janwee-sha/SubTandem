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
    let frame = ReadyFrame(protocolVersion: 1, port: 49_152, token: "opaque-token")
    let object = try JSONSerialization.jsonObject(with: JSONEncoder().encode(frame)) as? [String: Any]
    try check(Set(object?.keys.map { $0 } ?? []) == Set(["protocolVersion", "port", "token"]), "ready keys")
    try check(object?["protocolVersion"] as? Int == 1, "ready version")
    try check(object?["port"] as? Int == 49_152, "ready port")
    try check(object?["token"] as? String == "opaque-token", "ready token")

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
