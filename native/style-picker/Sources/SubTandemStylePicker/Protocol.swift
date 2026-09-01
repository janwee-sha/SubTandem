import Foundation
import Dispatch

struct ReadyFrame: Codable, Equatable, Sendable {
    let protocolVersion: Int
    let port: Int
    let token: String
}

struct RgbaColor: Codable, Equatable, Sendable {
    let r: Int
    let g: Int
    let b: Int
    let a: Int

    var valid: Bool {
        [r, g, b, a].allSatisfy { (0...255).contains($0) }
    }
}

struct FontOpenRequest: Codable, Equatable, Sendable {
    let requestId: String
    let fontFamily: String?
    let fontSize: Int
    let bold: Bool
    let italic: Bool
}

struct ColorOpenRequest: Codable, Equatable, Sendable {
    let requestId: String
    let color: RgbaColor
}

struct FontStatusRequest: Codable, Equatable, Sendable {
    let fontFamily: String?
}

struct RequestIdBody: Codable, Equatable, Sendable {
    let requestId: String
}

enum FontAvailability: String, Codable, Equatable, Sendable {
    case available
    case unavailable
}

struct FontStatus: Codable, Equatable, Sendable {
    let availability: FontAvailability
    let catalogRevision: Int
}

enum PickerEventPayload: Equatable, Sendable {
    case colorPreview(RgbaColor)
    case colorClosed(Bool, RgbaColor)
    case fontConfirmed(String?)
    case fontCancelled
    case fontCatalogChanged(Int)
    case pickerFailed(String)
}

struct PickerEvent: Encodable, Equatable, Sendable {
    let revision: Int
    let requestId: String
    let payload: PickerEventPayload

    enum CodingKeys: String, CodingKey {
        case revision
        case requestId
        case type
        case color
        case changed
        case fontFamily
        case catalogRevision
        case code
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(revision, forKey: .revision)
        try container.encode(requestId, forKey: .requestId)
        switch payload {
        case .colorPreview(let color):
            try container.encode("color-preview", forKey: .type)
            try container.encode(color, forKey: .color)
        case .colorClosed(let changed, let color):
            try container.encode("color-closed", forKey: .type)
            try container.encode(changed, forKey: .changed)
            try container.encode(color, forKey: .color)
        case .fontConfirmed(let family):
            try container.encode("font-confirmed", forKey: .type)
            try container.encode(family, forKey: .fontFamily)
        case .fontCancelled:
            try container.encode("font-cancelled", forKey: .type)
        case .fontCatalogChanged(let revision):
            try container.encode("font-catalog-changed", forKey: .type)
            try container.encode(revision, forKey: .catalogRevision)
        case .pickerFailed(let code):
            try container.encode("picker-failed", forKey: .type)
            try container.encode(code, forKey: .code)
        }
    }
}

struct PickerEventBatch: Encodable, Sendable {
    let events: [PickerEvent]
    let earliestRevision: Int
    let latestRevision: Int
    let gap: Bool

    enum CodingKeys: String, CodingKey {
        case events
        case earliestRevision
        case latestRevision
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(events, forKey: .events)
        try container.encode(earliestRevision, forKey: .earliestRevision)
        try container.encode(latestRevision, forKey: .latestRevision)
    }
}

final class PickerEventStore: @unchecked Sendable {
    private let lock = NSLock()
    private let capacity: Int
    private var revision = 0
    private var stored: [PickerEvent] = []

    init(capacity: Int = 256) {
        self.capacity = max(1, capacity)
    }

    func append(requestId: String, payload: PickerEventPayload) {
        lock.lock()
        defer { lock.unlock() }
        revision += 1
        stored.append(PickerEvent(revision: revision, requestId: requestId, payload: payload))
        if stored.count > capacity {
            stored.removeFirst(stored.count - capacity)
        }
    }

    func events(after: Int) -> PickerEventBatch {
        lock.lock()
        defer { lock.unlock() }
        let earliest = stored.first?.revision ?? revision
        return PickerEventBatch(
            events: stored.filter { $0.revision > after },
            earliestRevision: earliest,
            latestRevision: revision,
            gap: !stored.isEmpty && after + 1 < earliest
        )
    }
}

final class PickerLifecycle: @unchecked Sendable {
    private let lock = NSLock()
    private(set) var shuttingDown = false
    private var activeRequestId: String?

    func open(requestId: String) -> Bool {
        lock.lock()
        defer { lock.unlock() }
        guard !shuttingDown, activeRequestId == nil else { return false }
        activeRequestId = requestId
        return true
    }

    func cancel(requestId: String) -> Bool {
        lock.lock()
        defer { lock.unlock() }
        guard activeRequestId == requestId else { return false }
        activeRequestId = nil
        return true
    }

    func activate(requestId: String) -> Bool {
        lock.lock()
        defer { lock.unlock() }
        return !shuttingDown && activeRequestId == requestId
    }

    func complete(requestId: String) -> Bool {
        cancel(requestId: requestId)
    }

    func currentRequestId() -> String? {
        lock.lock()
        defer { lock.unlock() }
        return activeRequestId
    }

    func isActive(requestId: String) -> Bool {
        lock.lock()
        defer { lock.unlock() }
        return activeRequestId == requestId
    }

    func shutdown() {
        lock.lock()
        shuttingDown = true
        activeRequestId = nil
        lock.unlock()
    }
}

enum ProtocolError: Error {
    case invalid
}

enum ProtocolValidator {
    static let sizes = Set([30, 35, 40, 45, 50, 55, 60, 65, 70])

    static func authorized(headers: [String: String], token: String) -> Bool {
        headers.first { $0.key.lowercased() == "authorization" }?.value == "Bearer \(token)"
    }

    static func decodeFontOpen(_ data: Data) throws -> FontOpenRequest {
        let request: FontOpenRequest = try decodeExact(
            data,
            keys: ["requestId", "fontFamily", "fontSize", "bold", "italic"]
        )
        guard validId(request.requestId), validFamily(request.fontFamily), sizes.contains(request.fontSize) else {
            throw ProtocolError.invalid
        }
        return request
    }

    static func decodeColorOpen(_ data: Data) throws -> ColorOpenRequest {
        let request: ColorOpenRequest = try decodeExact(data, keys: ["requestId", "color"])
        guard validId(request.requestId), request.color.valid else { throw ProtocolError.invalid }
        return request
    }

    static func decodeFontStatus(_ data: Data) throws -> FontStatusRequest {
        let request: FontStatusRequest = try decodeExact(data, keys: ["fontFamily"])
        guard validFamily(request.fontFamily) else { throw ProtocolError.invalid }
        return request
    }

    static func decodeRequestId(_ data: Data) throws -> RequestIdBody {
        let request: RequestIdBody = try decodeExact(data, keys: ["requestId"])
        guard validId(request.requestId) else { throw ProtocolError.invalid }
        return request
    }

    static func decodeEmpty(_ data: Data) throws {
        guard data.count <= 65_536,
              let object = try JSONSerialization.jsonObject(with: data) as? [String: Any],
              object.isEmpty else { throw ProtocolError.invalid }
    }

    static func validId(_ value: String) -> Bool {
        value.range(of: #"^[A-Za-z0-9_.:-]{1,128}$"#, options: .regularExpression) != nil
    }

    static func validFamily(_ value: String?) -> Bool {
        guard let value else { return true }
        guard (1...256).contains(value.count) else { return false }
        return value.unicodeScalars.allSatisfy { !CharacterSet.controlCharacters.contains($0) }
    }

    private static func decodeExact<T: Decodable>(_ data: Data, keys: Set<String>) throws -> T {
        guard data.count <= 65_536,
              let object = try JSONSerialization.jsonObject(with: data) as? [String: Any],
              Set(object.keys) == keys else { throw ProtocolError.invalid }
        return try JSONDecoder().decode(T.self, from: data)
    }
}

enum ParentExitRule {
    static func shouldExit(parentPID: Int32?, isRunning: (Int32) -> Bool) -> Bool {
        guard let parentPID else { return false }
        return !isRunning(parentPID)
    }
}

func makeParentProcessMonitor(
    parentPID: Int32?,
    deadline: DispatchTime,
    repeating: DispatchTimeInterval,
    isRunning: @escaping @Sendable (Int32) -> Bool,
    onExit: @escaping @Sendable () -> Void
) -> DispatchSourceTimer {
    let timer = DispatchSource.makeTimerSource(queue: .global(qos: .utility))
    timer.schedule(deadline: deadline, repeating: repeating)
    timer.setEventHandler(handler: { @Sendable in
        guard ParentExitRule.shouldExit(parentPID: parentPID, isRunning: isRunning) else {
            return
        }
        onExit()
    })
    timer.resume()
    return timer
}
