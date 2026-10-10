import Foundation

func runFontCatalogTests() throws {
    let locales = ["af", "ca", "cs", "da", "de", "en", "en-GB", "es", "fi", "fr", "he", "hi", "hr", "hu", "id", "it", "ja", "ko", "nl", "pl", "pt", "pt-BR", "ro", "ru", "sk", "sr-Latn", "sv", "tr", "uk", "zh-Hans", "zh-Hant"]
    let families = ["École", "Alpha", "école", "model-2", "model-10", "中文", "אבג"]
    for locale in locales {
        let catalog = FontCatalog(locale: locale, families: families)
        let directory = catalog.directory()
        try check(directory.locale == locale && directory.catalogRevision == 0, "explicit font locale and revision")
        try check(directory.options.count == families.count, "complete font directory")
        let reference = Locale(identifier: locale)
        for index in 1..<directory.options.count {
            let left = directory.options[index - 1]
            let right = directory.options[index]
            let comparison = left.label.compare(right.label, options: [], range: nil, locale: reference)
            try check(comparison != .orderedDescending, "Foundation locale comparison")
            if comparison == .orderedSame {
                try check(left.familyId.unicodeScalars.map(\.value).lexicographicallyPrecedes(right.familyId.unicodeScalars.map(\.value)), "font ID codepoint tie")
            }
        }
        for option in directory.options {
            try check(option.familyId == option.displayName && option.displayName == option.label, "raw font family identity")
        }
        let filtered = catalog.directory(query: "ECOLE")
        try check(filtered.options.map(\.familyId) == directory.options.filter { ["École", "école"].contains($0.familyId) }.map(\.familyId), "case and accent filter preserves sorted order")
        let selection = FontSelection(originalFamily: "model-2")
        try check(selection.selectedRow(in: directory.options).map { directory.options[$0].familyId } == "model-2", "selection restored by family")
        try check(selection.selectedRow(in: catalog.directory(query: "Alpha").options) == nil, "hidden selection has no false row")
        try check(selection.confirm() == "model-2", "search retains exact selected identity")
        catalog.replaceFamilies(["Zulu", "model-2", "Beta"])
        let replacement = catalog.directory()
        try check(replacement.locale == locale && replacement.catalogRevision == 1, "cache revision replacement")
        try check(selection.selectedRow(in: replacement.options).map { replacement.options[$0].familyId } == "model-2", "replacement selection restored")
        catalog.replaceFamilies(["Beta"])
        try check(selection.selectedRow(in: catalog.directory().options) == nil, "removed family cannot choose another row")
        try check(selection.cancel() == "model-2", "cancel preserves original family after catalog change")
    }
}
