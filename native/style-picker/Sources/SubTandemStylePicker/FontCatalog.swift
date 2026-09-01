import AppKit
import CoreText
import Foundation

final class FontCatalog: @unchecked Sendable {
    private let lock = NSLock()
    private var families: [String]
    private(set) var catalogRevision = 0
    private var observer: NSObjectProtocol?

    init(families: [String] = NSFontManager.shared.availableFontFamilies) {
        self.families = Self.normalized(families)
    }

    deinit {
        if let observer {
            NotificationCenter.default.removeObserver(observer)
        }
    }

    static func filteredFamilies(_ families: [String], query: String) -> [String] {
        let normalizedQuery = query.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !normalizedQuery.isEmpty else { return families }
        return families.filter { $0.localizedCaseInsensitiveContains(normalizedQuery) }
    }

    func allFamilies() -> [String] {
        lock.lock()
        defer { lock.unlock() }
        return families
    }

    func status(for family: String?) -> FontStatus {
        lock.lock()
        defer { lock.unlock() }
        let availability: FontAvailability = family == nil || families.contains(family!)
            ? .available
            : .unavailable
        return FontStatus(availability: availability, catalogRevision: catalogRevision)
    }

    func replaceFamilies(_ next: [String]) {
        lock.lock()
        families = Self.normalized(next)
        catalogRevision += 1
        lock.unlock()
    }

    func startObserving(_ onChange: @escaping @Sendable (Int) -> Void) {
        let name = Notification.Name(kCTFontManagerRegisteredFontsChangedNotification as String)
        observer = NotificationCenter.default.addObserver(
            forName: name,
            object: nil,
            queue: .main
        ) { [weak self] _ in
            guard let self else { return }
            self.replaceFamilies(NSFontManager.shared.availableFontFamilies)
            onChange(self.catalogRevision)
        }
    }

    private static func normalized(_ values: [String]) -> [String] {
        Array(Set(values.filter { ProtocolValidator.validFamily($0) })).sorted {
            $0.localizedCaseInsensitiveCompare($1) == .orderedAscending
        }
    }
}
