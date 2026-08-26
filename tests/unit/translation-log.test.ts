import { describe, expect, it, vi } from "vitest";
import { PlaybackController } from "../../src/app/controller.js";
import { formatTranslationComparison } from "../../src/app/translation-log.js";

describe("session translation log", () => {
  it("formats source context and translation as an indented comparison", () => {
    expect(
      formatTranslationComparison({
        source: "target line one\r\ntarget line two",
        contextBefore: "previous subtitle",
        contextAfter: "next subtitle",
        translation: "translated line one\ntranslated line two",
      }),
    ).toBe(
      [
        "\n--------------------------------------------",
        "Context before:\n  previous subtitle",
        "Source cue:\n  target line one\n  target line two",
        "Context after:\n  next subtitle",
        "Translation:\n  translated line one\n  translated line two",
        "--------------------------------------------",
      ].join("\n"),
    );
  });

  it("logs only accepted translations and does not retain or expose rejected output", async () => {
    const messages: string[] = [];
    const controller = new PlaybackController({
      playerId: "translation-log",
      provider: {
        attempt: async (request) => ({
          translations: [
            ...request.items.map((item) => ({
              id: item.id,
              text: item.id === "cue-2" ? " translated target " : `translated ${item.id}`,
            })),
            { id: "unknown", text: "rejected output" },
          ],
        }),
      },
      overlay: { show: vi.fn(), clear: vi.fn() },
      targetLanguage: "zh-Hans",
      translationLog: (message) => messages.push(message),
    });
    controller.setSource({
      cues: [
        {
          id: "cue-1",
          index: 0,
          startMs: 0,
          endMs: 900,
          sourceText: "previous subtitle",
          normalizedText: "previous subtitle",
        },
        {
          id: "cue-2",
          index: 1,
          startMs: 1_000,
          endMs: 1_900,
          sourceText: "target subtitle",
          normalizedText: "target subtitle",
        },
        {
          id: "cue-3",
          index: 2,
          startMs: 2_000,
          endMs: 2_900,
          sourceText: "next subtitle",
          normalizedText: "next subtitle",
        },
      ],
      contentHash: "translation-log",
      language: "en",
      format: "srt",
    });

    controller.tick(1_000);
    await controller.whenIdle();

    const targetMessage = messages.find((message) =>
      message.includes("Source cue:\n  target subtitle"),
    );
    expect(targetMessage).toContain("Context before:\n  previous subtitle");
    expect(targetMessage).toContain("Context after:\n  next subtitle");
    expect(targetMessage).toContain("Translation:\n  translated target");
    expect(messages.join("\n")).not.toContain("rejected output");
  });

  it("keeps translation acceptance non-blocking when logging fails", async () => {
    const show = vi.fn();
    const controller = new PlaybackController({
      playerId: "translation-log-failure",
      provider: {
        attempt: async (request) => ({
          translations: request.items.map((item) => ({ id: item.id, text: "translated" })),
        }),
      },
      overlay: { show, clear: vi.fn() },
      targetLanguage: "zh-Hans",
      translationLog: () => {
        throw new Error("LOG_VIEWER_UNAVAILABLE");
      },
    });
    controller.setSource({
      cues: [
        {
          id: "cue-1",
          index: 0,
          startMs: 0,
          endMs: 900,
          sourceText: "source",
          normalizedText: "source",
        },
      ],
      contentHash: "translation-log-failure",
      language: "en",
      format: "srt",
    });

    controller.tick(0);
    await controller.whenIdle();

    expect(controller.cacheSize).toBe(1);
    expect(show).toHaveBeenCalledWith(["translated"]);
  });
});
