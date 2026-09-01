import { describe, expect, it } from "vitest";
import {
  parseSubtitleStyleEdit,
  parseSubtitleStyleGet,
  parseSubtitleStylePickerOpen,
  parseSubtitleStylePickerResult,
  parseSubtitleStyleSaveResult,
  parseSubtitleStyleState,
  serializeSubtitleStyleState,
} from "../../src/domain/messages.js";
import { DEFAULT_SUBTITLE_TEXT_STYLE } from "../../src/domain/subtitle-style.js";

const resolution = {
  preferredFamily: null,
  availability: "available" as const,
  effectiveFamily: null,
  fallbackActive: false,
  catalogRevision: 0,
};

const authority = {
  phase: "snapshot" as const,
  liveStyle: DEFAULT_SUBTITLE_TEXT_STYLE,
  committedStyle: DEFAULT_SUBTITLE_TEXT_STYLE,
  changedField: null,
  stateRevision: 1,
  latestIntentSequence: 0,
  committedRevision: 0,
  fontResolution: resolution,
};

const envelope = (payload: Record<string, unknown>) => ({
  requestId: "subtitle-style.window-1.1",
  revision: 1,
  payload,
});

describe("subtitle style message contracts", () => {
  it("accepts only an empty get envelope", () => {
    expect(parseSubtitleStyleGet(envelope({}))).toEqual(envelope({}));
    expect(() => parseSubtitleStyleGet(envelope({ text: "subtitle body" }))).toThrow(
      "INVALID_MESSAGE",
    );
  });

  it("accepts exact single-field preview and commit edits", () => {
    expect(
      parseSubtitleStyleEdit(
        envelope({
          interactionId: "style-edit.window-1.2",
          phase: "preview",
          field: "fontColor",
          value: { r: 1, g: 2, b: 3, a: 4 },
        }),
      ).payload,
    ).toEqual({
      interactionId: "style-edit.window-1.2",
      phase: "preview",
      field: "fontColor",
      value: { r: 1, g: 2, b: 3, a: 4 },
    });
    expect(
      parseSubtitleStyleEdit(
        envelope({
          interactionId: "style-edit.window-1.3",
          phase: "commit",
          field: "bold",
          value: true,
        }),
      ).payload.field,
    ).toBe("bold");
    for (const payload of [
      { interactionId: "x", phase: "commit", field: "bold", value: "true" },
      { interactionId: "x", phase: "commit", field: "fontSize", value: 41 },
      { interactionId: "x", phase: "commit", field: "unknown", value: true },
      { interactionId: "x", phase: "commit", field: "bold", value: true, lines: ["body"] },
    ]) {
      expect(() => parseSubtitleStyleEdit(envelope(payload))).toThrow("INVALID_MESSAGE");
    }
  });

  it("allows only the four picker field-kind combinations", () => {
    expect(
      parseSubtitleStylePickerOpen(envelope({ kind: "color", field: "backgroundColor" })).payload,
    ).toEqual({ kind: "color", field: "backgroundColor" });
    expect(
      parseSubtitleStylePickerOpen(envelope({ kind: "font", field: "fontFamily" })).payload,
    ).toEqual({ kind: "font", field: "fontFamily" });
    expect(() =>
      parseSubtitleStylePickerOpen(envelope({ kind: "color", field: "fontFamily" })),
    ).toThrow("INVALID_MESSAGE");
  });

  it("validates complete authority state and all three revisions", () => {
    expect(parseSubtitleStyleState(authority)).toEqual(authority);
    expect(serializeSubtitleStyleState(authority)).toEqual(authority);
    for (const invalid of [
      { ...authority, liveStyle: { ...authority.liveStyle, text: "body" } },
      { ...authority, stateRevision: -1 },
      { ...authority, latestIntentSequence: 0.5 },
      { ...authority, committedRevision: -1 },
      { ...authority, changedField: "unknown" },
    ]) {
      expect(() => parseSubtitleStyleState(invalid)).toThrow("INVALID_MESSAGE");
    }
  });

  it("validates safe save results without raw errors or body fields", () => {
    const success = {
      requestId: "subtitle-style.window-1.4",
      field: "fontSize",
      ok: true,
      outcome: "committed",
      intentSequence: 2,
      authority: { ...authority, phase: "committed" as const, stateRevision: 2 },
    };
    expect(parseSubtitleStyleSaveResult(success)).toEqual(success);
    const failure = {
      requestId: "subtitle-style.window-1.5",
      field: "italic",
      ok: false,
      code: "SUBTITLE_STYLE_SAVE_FAILED",
      userAction: "EDIT_AGAIN",
      intentSequence: 3,
      authority: { ...authority, phase: "reverted" as const, stateRevision: 3 },
    };
    expect(parseSubtitleStyleSaveResult(failure)).toEqual(failure);
    expect(() => parseSubtitleStyleSaveResult({ ...failure, rawError: "subtitle body" })).toThrow(
      "INVALID_MESSAGE",
    );
  });

  it("validates source-correlated picker outcomes", () => {
    for (const outcome of ["confirmed", "cancelled", "unchanged", "focused", "failed"] as const) {
      const result = {
        requestId: "subtitle-style.picker.window-1.1",
        outcome,
        authority,
      };
      expect(parseSubtitleStylePickerResult(result)).toEqual(result);
    }
    expect(() =>
      parseSubtitleStylePickerResult({
        requestId: "subtitle-style.picker.window-1.1",
        outcome: "busy",
        authority,
      }),
    ).toThrow("INVALID_MESSAGE");
    expect(() =>
      parseSubtitleStylePickerResult({
        requestId: "subtitle-style.picker.window-1.1",
        outcome: "failed",
        authority,
        error: "private body",
      }),
    ).toThrow("INVALID_MESSAGE");
  });
});
