import { describe, expect, it, vi } from "vitest";

import { PlaybackController, type TranslationOverlaySink } from "../../src/app/controller.js";
import { OllamaProvider } from "../../src/providers/ollama.js";
import type { TranslationProvider } from "../../src/providers/provider.js";
import { RecordingProvider } from "../helpers/fake-provider.js";
import {
  buildFixtureCues,
  loadProviderLanguageDetectionFixture,
} from "../helpers/provider-language-detection.js";

class RecordingOverlay implements TranslationOverlaySink {
  readonly frames: string[][] = [];
  clears = 0;

  show(lines: readonly string[]): void {
    this.frames.push([...lines]);
  }

  clear(): void {
    this.clears += 1;
  }
}

const fixture = loadProviderLanguageDetectionFixture();

function sourceFor(testCase: (typeof fixture.cases)[number], contentHash = testCase.id) {
  return {
    cues: buildFixtureCues(testCase),
    contentHash,
    format: "srt" as const,
  };
}

function ollamaTarget(content: string): { id: string; text: string } {
  const payload = /INPUT_JSON_BEGIN\n([\s\S]*?)\nINPUT_JSON_END/.exec(content)?.[1];
  const parsed = JSON.parse(payload ?? content) as {
    targets: Array<{ id: string; text: string }>;
  };
  return parsed.targets[0]!;
}

describe("provider language detection", () => {
  it.each(
    fixture.cases
      .filter((testCase) =>
        [
          "short-five-cues",
          "short-eleven-cues-missing-label",
          "medium-natural-dialogue",
          "romanized-dialogue",
          "mixed-language-batch",
        ].includes(testCase.id),
      )
      .map((testCase) => [testCase.id, testCase] as const),
  )("admits %s directly without a local source-language result", async (_id, testCase) => {
    const provider = new RecordingProvider();
    const controller = new PlaybackController({
      playerId: testCase.id,
      provider,
      overlay: new RecordingOverlay(),
      targetLanguage: testCase.targetLanguage,
    });
    controller.setSource(sourceFor(testCase));

    const readyAt = Date.now();
    controller.tick(0);
    await controller.whenIdle();

    expect(provider.requests).toHaveLength(1);
    expect(Date.now() - readyAt).toBeLessThanOrEqual(500);
    expect(provider.requests[0]!.targetLanguage).toBe(testCase.targetLanguage);
    expect(provider.requests[0]).not.toHaveProperty("sourceLanguage");
    expect(provider.requests[0]!.items.length).toBeLessThanOrEqual(25);
    expect(
      provider.requests[0]!.items.reduce((total, item) => total + [...item.text].length, 0),
    ).toBeLessThanOrEqual(5_000);
  });

  it("retries only unresolved frozen targets without detecting between attempts", async () => {
    vi.useFakeTimers();
    const testCase = fixture.cases.find((entry) => entry.id === "mixed-language-batch")!;
    const attempts: string[][] = [];
    let attempt = 0;
    const provider: TranslationProvider = {
      attempt: async (request, onProgress) => {
        attempts.push(request.items.map((item) => item.id));
        attempt += 1;
        if (attempt === 1) {
          onProgress?.({ translations: [{ id: request.items[0]!.id, text: "same" }] });
          throw { category: "network", retryable: true };
        }
        return {
          translations: request.items.map((item) => ({ id: item.id, text: `T:${item.text}` })),
        };
      },
    };
    const controller = new PlaybackController({
      playerId: "retry",
      provider,
      overlay: new RecordingOverlay(),
      targetLanguage: testCase.targetLanguage,
      random: () => 0,
    });
    controller.setSource(sourceFor(testCase));

    controller.tick(0);
    await vi.runAllTimersAsync();
    await controller.whenIdle();

    expect(attempts).toHaveLength(2);
    expect(attempts[1]).toEqual(attempts[0]!.slice(1));
    expect(controller.status).toBe("running");
    vi.useRealTimers();
  });

  it("rejects delayed results after source, target, profile, disable, seek, end, or close changes", async () => {
    const testCase = fixture.cases.find((entry) => entry.id === "short-five-cues")!;
    const changes = [
      (controller: PlaybackController) => controller.setSource(sourceFor(testCase, "next")),
      (controller: PlaybackController) => controller.setTargetLanguage("fr"),
      (controller: PlaybackController) =>
        controller.setProviderSelection({
          profileId: "next-profile",
          revision: 2,
          endpointFingerprint: "next-endpoint",
          kind: "openai",
        }),
      (controller: PlaybackController) => controller.setEnabled(false),
      (controller: PlaybackController) => controller.onSeek(2_000),
      (controller: PlaybackController) => controller.endFile(),
      (controller: PlaybackController) => controller.close(),
    ];

    for (const [index, change] of changes.entries()) {
      let resolve!: (value: { translations: Array<{ id: string; text: string }> }) => void;
      const overlay = new RecordingOverlay();
      const provider: TranslationProvider = {
        attempt: (request) =>
          new Promise((done) => {
            resolve = done;
            expect(request).not.toHaveProperty("sourceLanguage");
          }),
      };
      const controller = new PlaybackController({
        playerId: `lifecycle-${index}`,
        provider,
        overlay,
        targetLanguage: testCase.targetLanguage,
      });
      controller.setSource(sourceFor(testCase));
      controller.tick(0);
      const clearsBeforeChange = overlay.clears;
      change(controller);
      resolve({ translations: [{ id: buildFixtureCues(testCase)[0]!.id, text: "late" }] });
      await controller.whenIdle();

      expect(overlay.frames).toEqual([]);
      expect(overlay.clears).toBeGreaterThan(clearsBeforeChange);
    }
  });

  it("isolates simultaneous windows and keeps bounded seek windows", async () => {
    const testCase = fixture.cases.find((entry) => entry.id === "medium-natural-dialogue")!;
    const providers = [new RecordingProvider(), new RecordingProvider()];
    const overlays = [new RecordingOverlay(), new RecordingOverlay()];
    const controllers = providers.map((provider, index) => {
      const controller = new PlaybackController({
        playerId: `window-${index}`,
        provider,
        overlay: overlays[index]!,
        targetLanguage: testCase.targetLanguage,
      });
      controller.setSource(sourceFor(testCase));
      return controller;
    });

    controllers[0]!.tick(0);
    controllers[1]!.tick(24_000);
    await Promise.all(controllers.map((controller) => controller.whenIdle()));

    expect(providers[0]!.requests[0]!.playerId).toContain("window-0");
    expect(providers[1]!.requests[0]!.playerId).toContain("window-1");
    expect(
      providers
        .flatMap((provider) => provider.requests)
        .every((request) => request.items.length <= 25),
    ).toBe(true);
    expect(overlays[0]!.frames.flat()).not.toEqual(overlays[1]!.frames.flat());
  });

  it("keeps a normalized Ollama response unchanged through progress, Controller and cache", async () => {
    let calls = 0;
    const provider = new OllamaProvider(
      { endpoint: "http://127.0.0.1:11434", model: "synthetic-model" },
      {
        request: async (request) => {
          calls += 1;
          const content = (request.body as { messages: Array<{ content: string }> }).messages.at(-1)!
            .content;
          const target = ollamaTarget(content);
          return {
            statusCode: 200,
            headers: {},
            bodyText: JSON.stringify({
              message: {
                content: JSON.stringify({
                  translations: [{ id: target.id, text: "hello" }],
                }),
              },
            }),
          };
        },
      },
    );
    const overlay = new RecordingOverlay();
    const controller = new PlaybackController({
      playerId: "normalized-response",
      provider,
      providerKind: "ollama",
      overlay,
      targetLanguage: "en",
    });
    controller.setSource({
      contentHash: "normalized-response",
      format: "srt",
      cues: [
        {
          id: "same-language",
          index: 0,
          startMs: 0,
          endMs: 2_000,
          sourceText: "  HELLO\n\n",
          normalizedText: "  HELLO\n\n",
        },
      ],
    });

    controller.tick(0);
    await controller.whenIdle();
    expect(overlay.frames.at(-1)).toEqual(["hello"]);
    expect(controller.cacheSize).toBe(1);
    expect(calls).toBe(1);

    controller.onSeek(0);
    controller.tick(0);
    await controller.whenIdle();
    expect(overlay.frames.at(-1)).toEqual(["hello"]);
    expect(calls).toBe(1);
  });

  it("submits a legal translation that shares ordinary text with adjacent context", async () => {
    let calls = 0;
    const outputs = new Map([
      ["Bonjour.", "Hello."],
      ["Merci, Alice.", "Thank you, Alice."],
      ["Alice", "Alice"],
    ]);
    const provider = new OllamaProvider(
      { endpoint: "http://127.0.0.1:11434", model: "synthetic-model" },
      {
        request: async (request) => {
          calls += 1;
          const content = (request.body as { messages: Array<{ content: string }> }).messages.at(-1)!
            .content;
          const target = ollamaTarget(content);
          return {
            statusCode: 200,
            headers: {},
            bodyText: JSON.stringify({
              message: {
                content: JSON.stringify({
                  translations: [{ id: target.id, text: outputs.get(target.text)! }],
                }),
              },
            }),
          };
        },
      },
    );
    const overlay = new RecordingOverlay();
    const controller = new PlaybackController({
      playerId: "shared-context",
      provider,
      providerKind: "ollama",
      overlay,
      targetLanguage: "en",
    });
    controller.setSource({
      contentHash: "shared-context",
      format: "srt",
      cues: ["Bonjour.", "Merci, Alice.", "Alice"].map((text, index) => ({
        id: `shared-${index}`,
        index,
        startMs: index * 2_000,
        endMs: index * 2_000 + 1_800,
        sourceText: text,
        normalizedText: text,
      })),
    });

    controller.tick(2_000);
    await controller.whenIdle();

    expect(overlay.frames.at(-1)).toEqual(["Thank you, Alice."]);
    expect(controller.cacheSize).toBe(2);
    expect(calls).toBe(2);
  });

  it("keeps later Ollama cues moving when one isolated wire times out", async () => {
    vi.useFakeTimers();
    try {
      const timeoutError = {
        category: "timeout",
        retryable: true,
        providerCode: "PROVIDER_TIMEOUT",
        userAction: "CHECK_NETWORK",
      } as const;
      const requestedTexts: string[] = [];
      let rejectFirstStall: ((reason: typeof timeoutError) => void) | undefined;
      let announceFirstStall: (() => void) | undefined;
      const firstStallStarted = new Promise<void>((resolve) => {
        announceFirstStall = resolve;
      });
      const provider = new OllamaProvider(
        { endpoint: "http://127.0.0.1:11434", model: "synthetic-model" },
        {
          request: async (request) => {
            const content = (request.body as { messages: Array<{ content: string }> }).messages.at(-1)!
              .content;
            const target = ollamaTarget(content);
            requestedTexts.push(target.text);
            if (target.text === "Stalled.") {
              if (!rejectFirstStall) {
                announceFirstStall?.();
                return new Promise((_, reject) => {
                  rejectFirstStall = reject;
                });
              }
              throw timeoutError;
            }
            return {
              statusCode: 200,
              headers: {},
              bodyText: JSON.stringify({
                message: {
                  content: JSON.stringify({
                    translations: [{ id: target.id, text: `T:${target.text}` }],
                  }),
                },
              }),
            };
          },
        },
      );
      let announceLaterShown: (() => void) | undefined;
      const laterShown = new Promise<void>((resolve) => {
        announceLaterShown = resolve;
      });
      const overlay = new RecordingOverlay();
      const recordShow = overlay.show.bind(overlay);
      overlay.show = (lines) => {
        recordShow(lines);
        if (lines.includes("T:Later.")) announceLaterShown?.();
      };
      const controller = new PlaybackController({
        playerId: "isolated-timeout",
        provider,
        providerKind: "ollama",
        overlay,
        targetLanguage: "zh-Hans",
        random: () => 0,
      });
      controller.setSource({
        contentHash: "isolated-timeout",
        format: "srt",
        cues: ["First.", "Stalled.", "Later."].map((text, index) => ({
          id: `timeout-${index}`,
          index,
          startMs: index * 1_000,
          endMs: index * 1_000 + 900,
          sourceText: text,
          normalizedText: text,
        })),
      });

      controller.tick(0);
      await firstStallStarted;
      controller.tick(2_000);
      rejectFirstStall?.(timeoutError);
      await laterShown;

      expect(requestedTexts).toContain("Later.");
      expect(controller.cacheSize).toBe(2);
      expect(overlay.frames.at(-1)).toEqual(["T:Later."]);

      await vi.runAllTimersAsync();
      await controller.whenIdle();
    } finally {
      vi.useRealTimers();
    }
  });
});
