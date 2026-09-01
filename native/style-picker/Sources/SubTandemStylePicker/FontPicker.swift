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
    private let panel = NSPanel(
        contentRect: NSRect(x: 0, y: 0, width: 460, height: 410),
        styleMask: [.titled, .closable, .resizable],
        backing: .buffered,
        defer: false
    )
    private let search = NSSearchField()
    private let table = NSTableView()
    private let preview = NSTextField(labelWithString: "SubTandem Preview")
    private let chooseButton = NSButton(title: "Choose", target: nil, action: nil)
    private let cancelButton = NSButton(title: "Cancel", target: nil, action: nil)
    private var scroll = NSScrollView()
    private var selection = FontSelection(originalFamily: nil)
    private var filtered: [String] = []
    private var requestId: String?
    private var fontSize = 40
    private var bold = false
    private var italic = false
    private var complete: ((String?, Bool) -> Void)?

    init(catalog: FontCatalog) {
        self.catalog = catalog
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
        filtered = catalog.allFamilies()
        table.reloadData()
        if let family = request.fontFamily, let row = filtered.firstIndex(of: family) {
            table.selectRowIndexes(IndexSet(integer: row), byExtendingSelection: false)
            table.scrollRowToVisible(row)
        } else {
            table.deselectAll(nil)
        }
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
        field.stringValue = filtered[row]
        field.font = NSFont.systemFont(ofSize: 13)
        field.setAccessibilityLabel("Font family")
        field.setAccessibilityValue(filtered[row])
        return field
    }

    func tableViewSelectionDidChange(_ notification: Notification) {
        guard table.selectedRow >= 0, table.selectedRow < filtered.count else {
            selection.preview(nil)
            updatePreview()
            return
        }
        selection.preview(filtered[table.selectedRow])
        updatePreview()
    }

    func controlTextDidChange(_ notification: Notification) {
        filtered = FontCatalog.filteredFamilies(catalog.allFamilies(), query: search.stringValue)
        table.reloadData()
        table.deselectAll(nil)
        updatePreview()
    }

    func windowShouldClose(_ sender: NSWindow) -> Bool {
        finish(confirmed: false)
        return false
    }

    private func configure() {
        panel.title = "Choose Translation Font"
        panel.delegate = self
        panel.isReleasedWhenClosed = false
        panel.minSize = NSSize(width: 360, height: 300)

        search.placeholderString = "Search Fonts"
        search.target = self
        search.action = #selector(searchChanged)
        search.sendsSearchStringImmediately = true
        search.setAccessibilityLabel("Search font families")

        let column = NSTableColumn(identifier: NSUserInterfaceItemIdentifier("FontFamily"))
        column.title = "Font Family"
        table.addTableColumn(column)
        table.headerView = nil
        table.dataSource = self
        table.delegate = self
        table.allowsEmptySelection = true
        table.setAccessibilityLabel("Available font families")

        scroll.documentView = table
        scroll.hasVerticalScroller = true
        scroll.borderType = .bezelBorder

        preview.alignment = .center
        preview.lineBreakMode = .byTruncatingTail
        preview.setAccessibilityLabel("Font preview")

        chooseButton.target = self
        chooseButton.action = #selector(choose)
        chooseButton.keyEquivalent = "\r"
        chooseButton.setAccessibilityHelp("Use the selected font family for translations")
        cancelButton.target = self
        cancelButton.action = #selector(cancelAction)
        cancelButton.keyEquivalent = "\u{1b}"
        cancelButton.setAccessibilityHelp("Keep the current translation font")

        let buttons = NSStackView(views: [cancelButton, chooseButton])
        buttons.orientation = .horizontal
        buttons.alignment = .centerY
        buttons.distribution = .fillEqually
        buttons.spacing = 8

        let content = NSStackView(views: [search, scroll, preview, buttons])
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
            buttons.widthAnchor.constraint(equalToConstant: 190),
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
        preview.stringValue = family ?? "System Default — SubTandem Preview"
        preview.setAccessibilityValue(preview.stringValue)
    }
}
