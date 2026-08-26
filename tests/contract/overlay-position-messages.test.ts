import { describe, expect, it } from "vitest";
import {
  parseOverlayClear,
  parseOverlayLayout,
  parseOverlayPositionGet,
  parseOverlayPositionPreview,
  parseOverlayPositionSave,
  parseOverlayPositionSaveResult,
  parseOverlayPositionState,
  parseOverlayReady,
  parseOverlayRender,
} from "../../src/domain/messages.js";

const envelope = (payload: Record<string, unknown>) => ({
  requestId: "overlay-position.window-a.8",
  revision: 1,
  payload,
});

describe("overlay position messages", () => {
  it.each([parseOverlayPositionPreview, parseOverlayPositionSave])(
    "accepts one integer position and rejects unknown or sensitive fields",
    (parse) => {
      expect(parse(envelope({ position: 42 })).payload.position).toBe(42);
      for (const payload of [
        { position: -1 },
        { position: 101 },
        { position: 1.5 },
        { position: "42" },
        { position: 42, text: "subtitle" },
      ]) {
        expect(() => parse(envelope(payload))).toThrow("INVALID_MESSAGE");
      }
    },
  );

  it("accepts only an empty get payload", () => {
    expect(parseOverlayPositionGet(envelope({})).payload).toEqual({});
    expect(() => parseOverlayPositionGet(envelope({ text: "subtitle" }))).toThrow(
      "INVALID_MESSAGE",
    );
  });

  it("strictly parses snapshot, preview, committed and reverted states", () => {
    const state = {
      phase: "preview",
      position: 42,
      committedPosition: 25,
      intentSequence: 18,
      committedRevision: 4,
    };
    expect(parseOverlayPositionState(state)).toEqual(state);
    expect(() => parseOverlayPositionState({ ...state, phase: "unknown" })).toThrow(
      "INVALID_MESSAGE",
    );
    expect(() => parseOverlayPositionState({ ...state, lines: ["subtitle"] })).toThrow(
      "INVALID_MESSAGE",
    );
    expect(() =>
      parseOverlayPositionState({ ...state, phase: "committed", committedPosition: 41 }),
    ).toThrow("INVALID_MESSAGE");
  });

  it("strictly parses correlated save results without internal error details", () => {
    expect(
      parseOverlayPositionSaveResult({
        requestId: "overlay-position.window-a.9",
        ok: true,
        position: 42,
        intentSequence: 18,
        committedRevision: 5,
      }),
    ).toMatchObject({ ok: true, position: 42 });
    expect(
      parseOverlayPositionSaveResult({
        requestId: "overlay-position.window-a.9",
        ok: false,
        code: "OVERLAY_POSITION_SAVE_FAILED",
        userAction: "NONE",
        committedPosition: 25,
        intentSequence: 18,
        committedRevision: 4,
      }),
    ).toMatchObject({ ok: false, committedPosition: 25 });
    expect(() =>
      parseOverlayPositionSaveResult({
        requestId: "overlay-position.window-a.9",
        ok: false,
        code: "private sync detail",
        userAction: "NONE",
        committedPosition: 25,
        intentSequence: 18,
        committedRevision: 4,
      }),
    ).toThrow("INVALID_MESSAGE");
  });

  it("strictly parses ready, layout, render and clear WebView messages", () => {
    const region = { top: 0.125, bottom: 0.875, marginX: 16, marginY: 16 };
    expect(parseOverlayReady({})).toEqual({});
    expect(parseOverlayLayout({ renderRevision: 1, position: 42, region })).toMatchObject({
      renderRevision: 1,
      position: 42,
    });
    expect(
      parseOverlayRender({ renderRevision: 2, lines: ["current"], position: 42, region }),
    ).toMatchObject({ lines: ["current"] });
    expect(parseOverlayClear({ renderRevision: 3 })).toEqual({ renderRevision: 3 });
    expect(() => parseOverlayReady({ text: "subtitle" })).toThrow("INVALID_MESSAGE");
    expect(() =>
      parseOverlayRender({ renderRevision: 2, lines: [""], position: 42, region }),
    ).toThrow("INVALID_MESSAGE");
  });
});
