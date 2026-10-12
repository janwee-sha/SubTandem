import Foundation

enum UiLocale: String, CaseIterable, Codable, Sendable {
    case af, ca, cs, da, de, en, es, fi, fr, he, hi, hr, hu, id, it, ja, ko, nl, pl, pt, ro, ru, sk, sv, tr, uk
    case enGB = "en-GB"
    case ptBR = "pt-BR"
    case srLatn = "sr-Latn"
    case zhHans = "zh-Hans"
    case zhHant = "zh-Hant"
}

enum NativeMessage: String, CaseIterable, Sendable {
    case subtandemPreview = "native.subtandemPreview"
    case choose = "native.choose"
    case cancel = "native.cancel"
    case fontFamily = "native.fontFamily"
    case chooseTranslationFont = "native.chooseTranslationFont"
    case searchFonts = "native.searchFonts"
    case searchFontFamilies = "native.searchFontFamilies"
    case availableFontFamilies = "native.availableFontFamilies"
    case fontPreview = "native.fontPreview"
    case useTheSelectedFontFamilyForTranslations = "native.useTheSelectedFontFamilyForTranslations"
    case keepTheCurrentTranslationFont = "native.keepTheCurrentTranslationFont"
    case systemDefaultSubTandemPreview = "native.systemDefaultSubTandemPreview"
    case translationSubtitleColor = "native.translationSubtitleColor"
}

struct NativeLocalizer: Sendable {
    let locale: UiLocale
    private let english: [String: String]
    private let current: [String: String]
    var isRightToLeft: Bool { locale == .he }

    init(locale: UiLocale, bundle: Bundle = .main) throws {
        self.locale = locale
        let baseline = Self.read(.en, bundle: bundle)
        guard NativeMessage.allCases.allSatisfy({ baseline[$0.rawValue] != nil }) else { throw ProtocolError.invalid }
        english = baseline
        current = Self.read(locale, bundle: bundle)
    }

    func text(_ key: NativeMessage) -> String {
        current[key.rawValue] ?? english[key.rawValue]!
    }

    private static func read(_ locale: UiLocale, bundle: Bundle) -> [String: String] {
        guard let root = bundle.resourceURL,
              let data = try? Data(contentsOf: root.appendingPathComponent("\(locale.rawValue).lproj/Localizable.strings")),
              let values = try? PropertyListSerialization.propertyList(from: data, options: [], format: nil) as? [String: Any] else { return [:] }
        return values.reduce(into: [:]) { output, entry in
            guard let text = entry.value as? String,
                  !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
                  text.range(of: "<\\/?[A-Za-z][^>]*>", options: .regularExpression) == nil,
                  !text.contains("{"), !text.contains("}"),
                  !text.unicodeScalars.contains(where: { $0.value < 32 && ![9, 10, 13].contains($0.value) }) else { return }
            output[entry.key] = text
        }
    }
}
