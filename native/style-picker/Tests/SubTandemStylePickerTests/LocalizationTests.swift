import Foundation

func runLocalizationTests() throws {
    let root = URL(fileURLWithPath: CommandLine.arguments[1])
    for locale in UiLocale.allCases {
        let localizer = try NativeLocalizer(locale: locale)
        let source = root.appendingPathComponent("shared/localization/catalogs/\(locale.rawValue).json")
        let object = try JSONSerialization.jsonObject(with: Data(contentsOf: source)) as! [String: Any]
        let messages = object["messages"] as! [String: Any]
        for key in NativeMessage.allCases {
            try check(localizer.text(key) == messages[key.rawValue] as? String, "exact generated native resource \(locale.rawValue)/\(key.rawValue)")
        }
        try check(localizer.isRightToLeft == (locale == .he), "explicit native direction")
        let arguments = ["launch", "--ready-file", "/private/test/.ready/style-picker-test.json", "--ui-locale", locale.rawValue, "-AppleLanguages", "(\(locale.rawValue))"]
        let parsed = try PickerArguments.parse(arguments)
        try check(parsed.uiLocale == locale && parsed.mode == .launch, "canonical native startup language")
        let detached = try DetachedBootstrap.daemonArguments(Array(arguments.dropFirst()), parentPID: 123)
        try check(detached == ["serve"] + Array(arguments.dropFirst()) + ["--parent-pid", "123"], "detached locale and argument domain unchanged")
        let served = try PickerArguments.parse(detached)
        try check(served.uiLocale == locale, "serve startup language")
    }
    for locale in ["ar", "zh", "sr-Cyrl", "en_gb", "EN", ""] {
        try checkThrows("non-canonical or unsupported native locale") {
            _ = try PickerArguments.parse(["launch", "--ready-file", "/private/test/.ready/style-picker-test.json", "--ui-locale", locale, "-AppleLanguages", "(\(locale))"])
        }
    }
    for arguments in [
        ["launch", "--ready-file", "/private/test/.ready/style-picker-test.json"],
        ["launch", "--ready-file", "relative/.ready/style-picker-test.json", "--ui-locale", "he", "-AppleLanguages", "(he)"],
        ["launch", "--ready-file", "/private/test/.ready/style-picker-test.json", "--ui-locale", "he", "-AppleLanguages", "(en)"],
        ["launch", "--ready-file", "/private/test/.ready/style-picker-test.json", "--ui-locale", "he", "-AppleLanguages", "(he)", "--extra", "value"],
    ] { try checkThrows("exact startup arguments") { _ = try PickerArguments.parse(arguments) } }

    let fault = FileManager.default.temporaryDirectory.appendingPathComponent("native-localizer-\(UUID().uuidString).app", isDirectory: true)
    defer { try? FileManager.default.removeItem(at: fault) }
    let contents = fault.appendingPathComponent("Contents", isDirectory: true)
    try FileManager.default.createDirectory(at: contents, withIntermediateDirectories: true)
    try FileManager.default.copyItem(at: Bundle.main.resourceURL!, to: contents.appendingPathComponent("Resources"))
    try PropertyListSerialization.data(fromPropertyList: ["CFBundleIdentifier": "io.subtandem.native-localizer-test", "CFBundlePackageType": "APPL", "CFBundleName": "NativeLocalizerTest"], format: .xml, options: 0).write(to: contents.appendingPathComponent("Info.plist"))
    let bundle = Bundle(url: fault)!
    let english = try NativeLocalizer(locale: .en, bundle: bundle)
    let french = contents.appendingPathComponent("Resources/fr.lproj/Localizable.strings")
    let original = try PropertyListSerialization.propertyList(from: Data(contentsOf: french), options: [], format: nil) as! [String: Any]
    for broken in ["", "   ", 42, "<b>Choose</b>", "{unknown}"] as [Any] {
        var values = original
        values[NativeMessage.choose.rawValue] = broken
        try PropertyListSerialization.data(fromPropertyList: values, format: .xml, options: 0).write(to: french)
        let localizer = try NativeLocalizer(locale: .fr, bundle: bundle)
        try check(localizer.text(.choose) == english.text(.choose), "complete English native entry fallback")
        try check(localizer.text(.cancel) == original[NativeMessage.cancel.rawValue] as? String, "other native entry remains French")
    }
    try FileManager.default.removeItem(at: french)
    let missing = try NativeLocalizer(locale: .fr, bundle: bundle)
    try check(missing.text(.choose) == english.text(.choose), "missing locale resource English fallback")
}
