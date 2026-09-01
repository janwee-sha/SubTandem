import Foundation

func runColorPickerTests() throws {
    let original = RgbaColor(r: 255, g: 255, b: 255, a: 128)
    let selection = ColorSelection(original: original)
    try check(selection.close().changed == false, "unchanged color close")
    try check(selection.preview(RgbaColor(r: 10, g: 20, b: 30, a: 40)), "first color preview")
    try check(!selection.preview(RgbaColor(r: 10, g: 20, b: 30, a: 40)), "duplicate color preview")
    try check(selection.preview(RgbaColor(r: 20, g: 30, b: 40, a: 50)), "continuous color preview")
    try check(selection.close() == ColorCloseResult(changed: true, color: RgbaColor(r: 20, g: 30, b: 40, a: 50)), "changed color close")
    try check(ColorQuantizer.channel(0) == 0, "zero channel")
    try check(ColorQuantizer.channel(0.5) == 128, "rounded channel")
    try check(ColorQuantizer.channel(1) == 255, "full channel")
    try check(ColorQuantizer.channel(-1) == 0, "lower channel clamp")
    try check(ColorQuantizer.channel(2) == 255, "upper channel clamp")
}
