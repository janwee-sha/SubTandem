import AppKit
import CoreText
import Foundation

struct SelectableFont: Equatable, Sendable {
    let familyId: String
    let displayName: String
    let label: String
}

struct FontDirectory: Equatable, Sendable {
    let locale: String
    let catalogRevision: Int
    let options: [SelectableFont]
}

final class FontCatalog: @unchecked Sendable {
    let uiLocale: String
    private let lock = NSLock()
    private var families: [String]
    private(set) var catalogRevision = 0
    private var cachedDirectory: FontDirectory?
    private var observer: NSObjectProtocol?

    init(locale: String, families: [String] = NSFontManager.shared.availableFontFamilies) {
        uiLocale = locale
        self.families = Self.normalized(families)
    }

    deinit {
        if let observer { NotificationCenter.default.removeObserver(observer) }
    }

    func directory(query: String = "") -> FontDirectory {
        lock.lock()
        defer { lock.unlock() }
        let locale = Locale(identifier: uiLocale)
        if cachedDirectory?.locale != uiLocale || cachedDirectory?.catalogRevision != catalogRevision {
            let options = families.map { SelectableFont(familyId: $0, displayName: $0, label: $0) }.sorted {
                let comparison = $0.label.compare($1.label, options: [], range: nil, locale: locale)
                return comparison == .orderedSame ? $0.familyId.unicodeScalars.map(\.value).lexicographicallyPrecedes($1.familyId.unicodeScalars.map(\.value)) : comparison == .orderedAscending
            }
            cachedDirectory = FontDirectory(locale: uiLocale, catalogRevision: catalogRevision, options: options)
        }
        let search = query.trimmingCharacters(in: .whitespacesAndNewlines)
        let directory = cachedDirectory!
        guard !search.isEmpty else { return directory }
        let filtered = directory.options.filter {
            $0.label.range(of: search, options: [.caseInsensitive, .diacriticInsensitive], range: nil, locale: locale) != nil
        }
        return FontDirectory(locale: uiLocale, catalogRevision: catalogRevision, options: filtered)
    }

    func status(for family: String?) -> FontStatus {
        lock.lock()
        defer { lock.unlock() }
        let availability: FontAvailability = family == nil || families.contains(family!) ? .available : .unavailable
        return FontStatus(availability: availability, catalogRevision: catalogRevision)
    }

    func replaceFamilies(_ next: [String]) {
        lock.lock()
        families = Self.normalized(next)
        catalogRevision += 1
        cachedDirectory = nil
        lock.unlock()
    }

    func startObserving(_ onChange: @escaping @Sendable (Int) -> Void) {
        let name = Notification.Name(kCTFontManagerRegisteredFontsChangedNotification as String)
        observer = NotificationCenter.default.addObserver(forName: name, object: nil, queue: .main) { [weak self] _ in
            guard let self else { return }
            self.replaceFamilies(NSFontManager.shared.availableFontFamilies)
            onChange(self.catalogRevision)
        }
    }

    private static func normalized(_ values: [String]) -> [String] {
        Array(Set(values.filter { ProtocolValidator.validFamily($0) }))
    }
}
