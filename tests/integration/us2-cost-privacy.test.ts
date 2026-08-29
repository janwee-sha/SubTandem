import { describe, expect, it } from "vitest";
import { PlaybackController, type TranslationOverlaySink } from "../../src/app/controller.js";
import { ClaudeProvider } from "../../src/providers/claude.js";
import type { ProviderTransportRequest } from "../../src/providers/transport.js";
import { RecordingProvider } from "../helpers/fake-provider.js";
import type { SubtitleCue } from "../../src/subtitles/types.js";

class Sink implements TranslationOverlaySink {
  frames: string[][] = [];
  show(lines: readonly string[]): void {
    this.frames.push([...lines]);
  }
  clear(): void {}
}

const longCues = Array.from({ length: 720 }, (_, index): SubtitleCue => ({
  id: `c${index}`,
  index,
  startMs: index * 5_000,
  endMs: index * 5_000 + 2_000,
  sourceText: `subtitle ${index}`,
  normalizedText: `subtitle ${index}`,
}));

describe("US2 cost/privacy acceptance", () => {
  it("makes zero calls for native or unknown source languages", async () => {
    const provider = new RecordingProvider();
    const controller = new PlaybackController({
      playerId: "A",
      provider,
      overlay: new Sink(),
      targetLanguage: "en-US",
    });
    controller.setSource({ cues: longCues, contentHash: "hash", language: "en-GB", format: "srt" });
    controller.tick(0);
    await controller.whenIdle();
    expect(provider.requests).toHaveLength(0);
    expect(controller.status).toBe("noTranslationNeeded");
    controller.setSource({ cues: longCues, contentHash: "hash", language: null, format: "srt" });
    controller.tick(0);
    expect(controller.status).toBe("detectingLanguage");
    expect(provider.requests).toHaveLength(0);
  });

  it("sends only bounded nearby text/languages/minimal context during ten-minute viewing", async () => {
    const provider = new RecordingProvider();
    const controller = new PlaybackController({
      playerId: "A",
      provider,
      overlay: new Sink(),
      targetLanguage: "zh-Hans",
    });
    controller.setSource({ cues: longCues, contentHash: "hash", language: "en", format: "srt" });
    for (let minute = 0; minute < 10; minute += 1) {
      controller.tick(minute * 60_000);
      await controller.whenIdle();
    }
    expect(provider.requests.length).toBeGreaterThan(0);
    expect(provider.requests.every((request) => request.items.length <= 25)).toBe(true);
    expect(
      provider.requests
        .flatMap((request) => request.items)
        .every((item) =>
          Object.keys(item).every((key) =>
            ["id", "text", "contextPrevious", "contextNext"].includes(key),
          ),
        ),
    ).toBe(true);
    expect(
      provider.requests
        .flatMap((request) => request.items)
        .every((item) => Number(item.id.slice(1)) * 5_000 <= 9 * 60_000 + 120_000),
    ).toBe(true);
    expect(
      provider.requests
        .flatMap((request) => request.items)
        .every(
          (item) =>
            [...(item.contextPrevious ?? "")].length + [...(item.contextNext ?? "")].length <= 500,
        ),
    ).toBe(true);
  });

  it("keeps request count, batching, lookahead, retries and outbound fields provider-independent", async () => {
    const providers = [new RecordingProvider(), new RecordingProvider()];
    for (const [index, provider] of providers.entries()) {
      const controller = new PlaybackController({
        playerId: `provider-${index}`,
        provider,
        overlay: new Sink(),
        targetLanguage: "zh-Hans",
      });
      controller.setSource({
        cues: longCues,
        contentHash: "same",
        language: "en",
        format: "srt",
      });
      controller.tick(60_000);
      await controller.whenIdle();
      controller.tick(60_000);
      await controller.whenIdle();
    }

    expect(providers[0]!.requests).toHaveLength(providers[1]!.requests.length);
    expect(
      providers.map((provider) => provider.requests.map((request) => request.items.length)),
    ).toEqual([[25], [25]]);
    for (const request of providers.flatMap((provider) => provider.requests)) {
      expect(
        request.items.every((item) => {
          const sourceIndex = Number(item.id.slice(1));
          return sourceIndex * 5_000 >= 60_000 && sourceIndex * 5_000 <= 180_000;
        }),
      ).toBe(true);
      expect(
        request.items.every((item) =>
          Object.keys(item).every((key) =>
            ["id", "text", "contextPrevious", "contextNext"].includes(key),
          ),
        ),
      ).toBe(true);
    }
  });

  it("keeps Claude wires bounded and credentials outside Messages bodies", async () => {
    const requests: ProviderTransportRequest[] = [];
    const provider = new ClaudeProvider(
      {
        endpoint: "https://api.anthropic.com",
        model: "exact-model-id",
        apiKey: "fictional-claude-key",
      },
      {
        request: async (request) => {
          requests.push(request);
          const body = request.body as { messages: Array<{ content: string }> };
          const targets = (
            JSON.parse(body.messages[0]!.content) as { targets: Array<{ id: string }> }
          ).targets;
          return {
            statusCode: 200,
            headers: {},
            bodyText: JSON.stringify({
              type: "message",
              role: "assistant",
              stop_reason: "end_turn",
              content: [
                {
                  type: "text",
                  text: JSON.stringify({
                    translations: targets.map((target) => ({
                      id: target.id,
                      text: `T:${target.id}`,
                    })),
                  }),
                },
              ],
            }),
          };
        },
      },
    );
    const controller = new PlaybackController({
      playerId: "claude-cost-privacy",
      provider,
      providerKind: "claude",
      overlay: new Sink(),
      targetLanguage: "zh-Hans",
    });
    controller.setSource({ cues: longCues, contentHash: "claude", language: "en", format: "srt" });

    controller.tick(60_000);
    await controller.whenIdle();

    expect(requests).toHaveLength(13);
    for (const request of requests) {
      const body = request.body as { messages: Array<{ content: string }> };
      const payload = JSON.parse(body.messages[0]!.content) as {
        targets: Array<Record<string, unknown>>;
      };
      expect(request.url).toBe("https://api.anthropic.com/v1/messages");
      expect(payload.targets.length).toBeLessThanOrEqual(2);
      expect(
        payload.targets.every((target) =>
          Object.keys(target).every((key) =>
            ["id", "text", "context_previous", "context_next"].includes(key),
          ),
        ),
      ).toBe(true);
      expect(JSON.stringify(request.body)).not.toContain("fictional-claude-key");
    }
  });

  it("invalidates rapid-seek/disable work, reuses backward cache, and purges on close/reopen", async () => {
    const provider = new RecordingProvider();
    const controller = new PlaybackController({
      playerId: "A",
      provider,
      overlay: new Sink(),
      targetLanguage: "zh-Hans",
    });
    controller.setSource({ cues: longCues, contentHash: "hash", language: "en", format: "srt" });
    controller.tick(0);
    await controller.whenIdle();
    const afterFirst = provider.requests.length;
    controller.tick(0);
    await controller.whenIdle();
    expect(provider.requests.length).toBe(afterFirst);
    expect(controller.cacheSize).toBeGreaterThan(0);
    controller.close();
    expect(controller.cacheSize).toBe(0);
    const reopened = new PlaybackController({
      playerId: "A",
      provider,
      overlay: new Sink(),
      targetLanguage: "zh-Hans",
    });
    reopened.setSource({ cues: longCues, contentHash: "hash", language: "en", format: "srt" });
    reopened.tick(0);
    await reopened.whenIdle();
    expect(provider.requests.length).toBeGreaterThan(afterFirst);
  });
});
