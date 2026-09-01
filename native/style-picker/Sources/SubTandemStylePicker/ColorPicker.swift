import AppKit
import Foundation

struct ColorCloseResult: Equatable {
    let changed: Bool
    let color: RgbaColor
}

final class ColorSelection {
    let original: RgbaColor
    private var current: RgbaColor
    private var changed = false

    init(original: RgbaColor) {
        self.original = original
        self.current = original
    }

    func preview(_ color: RgbaColor) -> Bool {
        guard color.valid, color != current else { return false }
        current = color
        changed = true
        return true
    }

    func close() -> ColorCloseResult {
        ColorCloseResult(changed: changed, color: current)
    }
}

enum ColorQuantizer {
    static func channel(_ value: CGFloat) -> Int {
        Int((min(1, max(0, value)) * 255).rounded())
    }

    static func rgba(_ color: NSColor) -> RgbaColor? {
        guard let converted = color.usingColorSpace(.sRGB) else { return nil }
        return RgbaColor(
            r: channel(converted.redComponent),
            g: channel(converted.greenComponent),
            b: channel(converted.blueComponent),
            a: channel(converted.alphaComponent)
        )
    }

    static func native(_ color: RgbaColor) -> NSColor {
        NSColor(
            srgbRed: CGFloat(color.r) / 255,
            green: CGFloat(color.g) / 255,
            blue: CGFloat(color.b) / 255,
            alpha: CGFloat(color.a) / 255
        )
    }
}

@MainActor
final class ColorPickerController: NSObject, NSWindowDelegate {
    private let panel = NSColorPanel.shared
    private var requestId: String?
    private var selection = ColorSelection(original: RgbaColor(r: 0, g: 0, b: 0, a: 0))
    private var previewHandler: ((RgbaColor) -> Void)?
    private var closeHandler: ((ColorCloseResult) -> Void)?

    override init() {
        super.init()
        panel.showsAlpha = true
        panel.isContinuous = true
        panel.setTarget(self)
        panel.setAction(#selector(colorChanged))
        panel.delegate = self
        panel.setAccessibilityLabel("Translation subtitle color")
    }

    func open(
        request: ColorOpenRequest,
        onPreview: @escaping (RgbaColor) -> Void,
        onClose: @escaping (ColorCloseResult) -> Void
    ) {
        requestId = request.requestId
        selection = ColorSelection(original: request.color)
        previewHandler = onPreview
        closeHandler = onClose
        panel.color = ColorQuantizer.native(request.color)
        NSApp.activate(ignoringOtherApps: true)
        panel.makeKeyAndOrderFront(nil)
    }

    func cancel(requestId: String) -> RgbaColor? {
        guard self.requestId == requestId else { return nil }
        let original = selection.original
        reset()
        panel.orderOut(nil)
        return original
    }

    func closeForShutdown() {
        reset()
        panel.orderOut(nil)
    }

    func windowShouldClose(_ sender: NSWindow) -> Bool {
        finish()
        return false
    }

    @objc private func colorChanged() {
        guard requestId != nil,
              let color = ColorQuantizer.rgba(panel.color),
              selection.preview(color) else { return }
        previewHandler?(color)
    }

    private func finish() {
        guard requestId != nil else { return }
        let result = selection.close()
        let callback = closeHandler
        reset()
        panel.orderOut(nil)
        callback?(result)
    }

    private func reset() {
        requestId = nil
        previewHandler = nil
        closeHandler = nil
    }
}
