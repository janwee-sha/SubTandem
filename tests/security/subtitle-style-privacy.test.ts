import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseSubtitleStyleEdit, parseSubtitleStylePickerOpen } from "../../src/domain/messages.js";
import { SubtitleStylePreferences } from "../../src/adapters/iina/subtitle-style-preferences.js";
import { FakeIinaPreferences } from "../helpers/fake-iina.js";

const envelope = (payload: Record<string, unknown>) => ({
  requestId: "style.safe",
  revision: 1,
  payload,
});

describe("subtitle style privacy boundary", () => {
  it("rejects subtitle, translation, media, token and path fields from style messages", () => {
    for (const field of ["subtitle", "translation", "mediaPath", "token", "fontPath"]) {
      expect(() =>
        parseSubtitleStylePickerOpen(
          envelope({ kind: "color", field: "fontColor", [field]: "PRIVATE_BODY" }),
        ),
      ).toThrow("INVALID_MESSAGE");
      expect(() =>
        parseSubtitleStyleEdit(
          envelope({
            interactionId: "style.1",
            phase: "preview",
            field: "fontColor",
            value: { r: 1, g: 2, b: 3, a: 4 },
            [field]: "PRIVATE_BODY",
          }),
        ),
      ).toThrow("INVALID_MESSAGE");
    }
  });

  it("persists only the eight style fields in one preference value", () => {
    const store = new FakeIinaPreferences();
    const preferences = new SubtitleStylePreferences(store);
    preferences.save({
      fontColor: { r: 1, g: 2, b: 3, a: 4 },
      fontSize: 40,
      fontFamily: null,
      bold: false,
      italic: false,
      borderColor: { r: 5, g: 6, b: 7, a: 8 },
      borderWidth: 3,
      backgroundColor: { r: 9, g: 10, b: 11, a: 12 },
    });
    const raw = store.values.get("translationSubtitleTextStyle") as string;
    expect(Object.keys(JSON.parse(raw)).sort()).toEqual([
      "backgroundColor",
      "bold",
      "borderColor",
      "borderWidth",
      "fontColor",
      "fontFamily",
      "fontSize",
      "italic",
    ]);
    expect(raw).not.toMatch(/subtitle|translation|media|token|path/i);
  });

  it("keeps the helper on authenticated loopback without external destinations", () => {
    const server = readFileSync(
      new URL(
        "../../native/style-picker/Sources/SubTandemStylePicker/Server.swift",
        import.meta.url,
      ),
      "utf8",
    );
    expect(server).toContain('host: "127.0.0.1"');
    expect(server).toContain("ProtocolValidator.authorized");
    expect(server).not.toMatch(/https?:\/\/(?!127\.0\.0\.1)/);
  });
});
