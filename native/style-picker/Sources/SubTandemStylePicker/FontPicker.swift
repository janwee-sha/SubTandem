import AppKit
import Foundation

final class FontSelection {
    let originalFamily: String?
    private var previewFamily: String?

    init(originalFamily: String?) {
        self.originalFamily = originalFamily
        self.previewFamily = originalFamily
    }

    func preview(_ family: String?) {
        previewFamily = family
    }

    func selectedRow(in options: [SelectableFont]) -> Int? {
        options.firstIndex { $0.familyId == previewFamily }
    }

    func confirm() -> String? {
        previewFamily
    }

    func cancel() -> String? {
        originalFamily
    }
}

@MainActor
final class FontPickerController: NSObject, NSTableViewDataSource, NSTableViewDelegate, NSWindowDelegate {
    private let catalog: FontCatalog
    private let localizer: NativeLocalizer
    private let panel = NSPanel(
        contentRect: NSRect(x: 0, y: 0, width: 460, height: 410),
        styleMask: [.titled, .closable, .resizable],
        backing: .buffered,
        defer: false
    )
    private let search = NSSearchField()
    private let table = NSTableView()
    private let preview = NSTextField(labelWithString: "")
    private let chooseButton = NSButton(title: "", target: nil, action: nil)
    private let cancelButton = NSButton(title: "", target: nil, action: nil)
    private var scroll = NSScrollView()
    private var selection = FontSelection(originalFamily: nil)
    private var filtered: [SelectableFont] = []
    private var restoringSelection = false
    private var requestId: String?
    private var fontSize = 40
    private var bold = false
    private var italic = false
    private var complete: ((String?, Bool) -> Void)?

    init(catalog: FontCatalog, localizer: NativeLocalizer) {
        self.catalog = catalog
        self.localizer = localizer
        super.init()
        configure()
    }

    func open(
        request: FontOpenRequest,
        completion: @escaping (String?, Bool) -> Void
    ) {
        requestId = request.requestId
        selection = FontSelection(originalFamily: request.fontFamily)
        fontSize = request.fontSize
        bold = request.bold
        italic = request.italic
        complete = completion
        search.stringValue = ""
        filtered = catalog.directory().options
        restoringSelection = true
        table.reloadData()
        if let family = request.fontFamily, let row = filtered.firstIndex(where: { $0.familyId == family }) {
            table.selectRowIndexes(IndexSet(integer: row), byExtendingSelection: false)
            table.scrollRowToVisible(row)
        } else {
            table.deselectAll(nil)
        }
        restoringSelection = false
        updatePreview()
        NSApp.activate(ignoringOtherApps: true)
        panel.center()
        panel.makeKeyAndOrderFront(nil)
        panel.makeFirstResponder(search)
    }

    func cancel(requestId: String) {
        guard self.requestId == requestId else { return }
        finish(confirmed: false)
    }

    func activate(requestId: String) -> Bool {
        guard self.requestId == requestId else { return false }
        NSApp.activate(ignoringOtherApps: true)
        panel.makeKeyAndOrderFront(nil)
        return true
    }

    func closeForShutdown() {
        requestId = nil
        complete = nil
        panel.orderOut(nil)
    }

    func numberOfRows(in tableView: NSTableView) -> Int {
        filtered.count
    }

    func tableView(_ tableView: NSTableView, viewFor tableColumn: NSTableColumn?, row: Int) -> NSView? {
        let identifier = NSUserInterfaceItemIdentifier("FontFamilyCell")
        let field = (tableView.makeView(withIdentifier: identifier, owner: self) as? NSTextField)
            ?? NSTextField(labelWithString: "")
        field.identifier = identifier
        field.stringValue = filtered[row].label
        field.font = NSFont.systemFont(ofSize: 13)
        field.setAccessibilityLabel(localizer.text(.fontFamily))
        field.setAccessibilityValue(filtered[row].label)
        return field
    }

    func tableViewSelectionDidChange(_ notification: Notification) {
        if restoringSelection { return }
        guard table.selectedRow >= 0, table.selectedRow < filtered.count else {
            selection.preview(nil)
            updatePreview()
            return
        }
        selection.preview(filtered[table.selectedRow].familyId)
        updatePreview()
    }

    func controlTextDidChange(_ notification: Notification) {
        reloadCatalog()
    }

    func reloadCatalog() {
        restoringSelection = true
        filtered = catalog.directory(query: search.stringValue).options
        table.reloadData()
        if let row = selection.selectedRow(in: filtered) {
            table.selectRowIndexes(IndexSet(integer: row), byExtendingSelection: false)
        } else { table.deselectAll(nil) }
        restoringSelection = false
        updatePreview()
    }

    func windowShouldClose(_ sender: NSWindow) -> Bool {
        finish(confirmed: false)
        return false
    }

    private func configure() {
        panel.title = localizer.text(.chooseTranslationFont)
        chooseButton.title = localizer.text(.choose)
        cancelButton.title = localizer.text(.cancel)
        preview.stringValue = localizer.text(.subtandemPreview)
        panel.delegate = self
        panel.isReleasedWhenClosed = false
        panel.minSize = NSSize(width: 360, height: 300)

        search.placeholderString = localizer.text(.searchFonts)
        search.target = self
        search.action = #selector(searchChanged)
        search.sendsSearchStringImmediately = true
        search.setAccessibilityLabel(localizer.text(.searchFontFamilies))

        let column = NSTableColumn(identifier: NSUserInterfaceItemIdentifier("FontFamily"))
        column.title = localizer.text(.fontFamily)
        table.addTableColumn(column)
        table.headerView = nil
        table.dataSource = self
        table.delegate = self
        table.allowsEmptySelection = true
        table.setAccessibilityLabel(localizer.text(.availableFontFamilies))

        scroll.documentView = table
        scroll.hasVerticalScroller = true
        scroll.borderType = .bezelBorder

        preview.alignment = .center
        preview.lineBreakMode = .byTruncatingTail
        preview.setAccessibilityLabel(localizer.text(.fontPreview))

        chooseButton.target = self
        chooseButton.action = #selector(choose)
        chooseButton.keyEquivalent = "\r"
        chooseButton.setAccessibilityHelp(localizer.text(.useTheSelectedFontFamilyForTranslations))
        cancelButton.target = self
        cancelButton.action = #selector(cancelAction)
        cancelButton.keyEquivalent = "\u{1b}"
        cancelButton.setAccessibilityHelp(localizer.text(.keepTheCurrentTranslationFont))

        let buttons = NSStackView(views: [cancelButton, chooseButton])
        buttons.orientation = .horizontal
        buttons.alignment = .centerY
        buttons.distribution = .fillEqually
        buttons.spacing = 8

        let content = NSStackView(views: [search, scroll, preview, buttons])
        content.userInterfaceLayoutDirection = localizer.isRightToLeft ? .rightToLeft : .leftToRight
        search.userInterfaceLayoutDirection = content.userInterfaceLayoutDirection
        table.userInterfaceLayoutDirection = content.userInterfaceLayoutDirection
        buttons.userInterfaceLayoutDirection = content.userInterfaceLayoutDirection
        content.orientation = .vertical
        content.alignment = .leading
        content.spacing = 10
        content.edgeInsets = NSEdgeInsets(top: 16, left: 16, bottom: 16, right: 16)
        content.translatesAutoresizingMaskIntoConstraints = false
        panel.contentView = NSView()
        panel.contentView?.addSubview(content)
        NSLayoutConstraint.activate([
            content.leadingAnchor.constraint(equalTo: panel.contentView!.leadingAnchor),
            content.trailingAnchor.constraint(equalTo: panel.contentView!.trailingAnchor),
            content.topAnchor.constraint(equalTo: panel.contentView!.topAnchor),
            content.bottomAnchor.constraint(equalTo: panel.contentView!.bottomAnchor),
            search.widthAnchor.constraint(equalTo: content.widthAnchor, constant: -32),
            scroll.widthAnchor.constraint(equalTo: content.widthAnchor, constant: -32),
            scroll.heightAnchor.constraint(greaterThanOrEqualToConstant: 180),
            preview.widthAnchor.constraint(equalTo: content.widthAnchor, constant: -32),
            buttons.widthAnchor.constraint(greaterThanOrEqualToConstant: 190),
            buttons.widthAnchor.constraint(lessThanOrEqualTo: content.widthAnchor, constant: -32),
        ])
    }

    @objc private func searchChanged() {
        controlTextDidChange(Notification(name: NSControl.textDidChangeNotification, object: search))
    }

    @objc private func choose() {
        finish(confirmed: true)
    }

    @objc private func cancelAction() {
        finish(confirmed: false)
    }

    private func finish(confirmed: Bool) {
        guard requestId != nil else { return }
        let result = confirmed ? selection.confirm() : selection.cancel()
        let callback = complete
        requestId = nil
        complete = nil
        panel.orderOut(nil)
        callback?(result, confirmed)
    }

    private func updatePreview() {
        let family = selection.confirm()
        var traits: NSFontTraitMask = []
        if bold { traits.insert(.boldFontMask) }
        if italic { traits.insert(.italicFontMask) }
        let size = max(12, min(48, CGFloat(fontSize) * 0.5))
        let base = family.flatMap { NSFontManager.shared.font(withFamily: $0, traits: traits, weight: 5, size: size) }
        preview.font = base ?? NSFont.systemFont(ofSize: size, weight: bold ? .bold : .regular)
        preview.stringValue = family ?? localizer.text(.systemDefaultSubTandemPreview)
        preview.setAccessibilityValue(preview.stringValue)
    }
}
