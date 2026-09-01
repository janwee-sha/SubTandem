import Foundation

func runFontPickerTests() throws {
    let families = ["Avenir Next", "Helvetica Neue", "Noto Sans CJK"]
    try check(FontCatalog.filteredFamilies(families, query: "avenir") == ["Avenir Next"], "font filtering")
    try check(FontCatalog.filteredFamilies(families, query: "SANS") == ["Noto Sans CJK"], "case-insensitive filtering")
    try check(FontCatalog.filteredFamilies(families, query: "") == families, "empty font filtering")

    let selection = FontSelection(originalFamily: "Avenir Next")
    selection.preview("Helvetica Neue")
    try check(selection.cancel() == "Avenir Next", "font cancel")
    selection.preview("Helvetica Neue")
    try check(selection.confirm() == "Helvetica Neue", "font confirm")

    let catalog = FontCatalog(families: ["Avenir Next", "Helvetica Neue"])
    try check(catalog.status(for: nil) == FontStatus(availability: .available, catalogRevision: 0), "system font status")
    try check(catalog.status(for: "Avenir Next").availability == .available, "available font status")
    try check(catalog.status(for: "Missing Family").availability == .unavailable, "unavailable font status")
    catalog.replaceFamilies(["Missing Family"])
    try check(catalog.status(for: "Missing Family") == FontStatus(availability: .available, catalogRevision: 1), "catalog revision")

    try check(!ParentExitRule.shouldExit(parentPID: nil, isRunning: { _ in false }), "missing parent")
    try check(!ParentExitRule.shouldExit(parentPID: 123, isRunning: { $0 == 123 }), "running parent")
    try check(ParentExitRule.shouldExit(parentPID: 123, isRunning: { _ in false }), "exited parent")
}
