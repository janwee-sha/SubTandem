import { describe, expect, it } from "vitest";
import { PlaybackController, type TranslationOverlaySink } from "../../src/app/controller.js";
import { SubtitlePreparationCoordinator } from "../../src/app/subtitle-preparation.js";
import { utf8Encode } from "../../src/domain/codec.js";
import { sha256Hex } from "../../src/domain/identity.js";
import { classifySubtitleSelection } from "../../src/adapters/iina/subtitle-source.js";
import { RecordingProvider } from "../helpers/fake-provider.js";

const subtitle = "1\n00:00:01,000 --> 00:00:02,000\nHello\n";
const jobId = "7a90a4e6-cc4f-4f59-99b7-8ff522f887ae";

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

describe("embedded subtitle translation", () => {
  it("prepares the exact supported track and enters the existing finite translation path", async () => {
    const bytes = utf8Encode(subtitle);
    const released: string[] = [];
    const coordinator = new SubtitlePreparationCoordinator({
      playerId: "player-A",
      extractor: {
        prepare: async () => ({
          jobId,
          state: "ready",
          resultId: jobId,
          format: "srt",
          cueCount: 1,
          byteCount: bytes.length,
          sha256: sha256Hex(bytes),
        }),
        cancel: async () => "already-completed",
        release: async (resultId) => {
          released.push(resultId);
        },
        shutdown: async () => undefined,
      },
      readResult: () => bytes,
      createId: () => jobId,
    });
    const prepared = await coordinator.prepare(
      {
        playerId: "player-A",
        mediaEpoch: 1,
        localPath: "/private/media/movie.mkv",
        isNetworkResource: false,
      },
      {
        trackId: 7,
        origin: "embedded",
        codec: "ass",
        ffIndex: 3,
        sourceId: 12,
        language: "en",
      },
    );
    expect(prepared?.cues).toHaveLength(1);
    expect(released).toEqual([jobId]);

    const provider = new RecordingProvider();
    const overlay = new RecordingOverlay();
    const controller = new PlaybackController({
      playerId: "player-A",
      provider,
      overlay,
      targetLanguage: "zh-Hans",
      requiresProviderSelection: true,
    });
    controller.setProviderSelection({
      profileId: "profile-A",
      revision: 2,
      endpointFingerprint: "endpoint-2",
    });
    controller.setSource({
      cues: prepared!.cues,
      contentHash: prepared!.contentHash,
      language: null,
      format: "srt",
    });
    controller.setLanguageDetection({ languageId: "en" });
    controller.tick(1_000);
    await controller.whenIdle();

    expect(provider.requests).toHaveLength(1);
    expect(provider.requests[0]).toMatchObject({ profileId: "profile-A", profileRevision: 2 });
    expect(provider.requests[0]?.items).toHaveLength(1);
    expect(overlay.frames.at(-1)).toEqual(["translated:Hello"]);
  });

  it("uses the latest playback position after seek and rejects the old profile revision", async () => {
    let progress:
      ((value: { translations: Array<{ id: string; text: string }> }) => void) | undefined;
    const provider = new RecordingProvider();
    provider.enqueue(
      (request, onProgress) =>
        new Promise((resolve) => {
          progress = onProgress;
          controller.setProviderSelection({
            profileId: "profile-A",
            revision: 2,
            endpointFingerprint: "endpoint-2",
          });
          progress?.({
            translations: request.items.map((item) => ({ id: item.id, text: "late" })),
          });
          resolve({ translations: [] });
        }),
    );
    const overlay = new RecordingOverlay();
    const controller = new PlaybackController({
      playerId: "player-A",
      provider,
      overlay,
      targetLanguage: "zh-Hans",
    });
    controller.setProviderSelection({
      profileId: "profile-A",
      revision: 1,
      endpointFingerprint: "endpoint-1",
    });
    controller.setSource({
      cues: [
        {
          id: "cue-1",
          index: 0,
          startMs: 1_000,
          endMs: 2_000,
          sourceText: "Hello",
          normalizedText: "Hello",
        },
      ],
      contentHash: "hash",
      language: "en",
      format: "srt",
    });
    controller.onSeek(1_000);
    controller.tick(1_000);
    await controller.whenIdle();
    expect(provider.requests[0]).toMatchObject({ profileRevision: 1 });
    expect(overlay.frames).toHaveLength(0);
  });

  it("isolates simultaneous windows and exact same-metadata tracks", async () => {
    const firstBytes = utf8Encode(subtitle);
    const secondBytes = utf8Encode(subtitle.replace("Hello", "Other"));
    const build = (playerId: string, resultBytes: Uint8Array, id: string) =>
      new SubtitlePreparationCoordinator({
        playerId,
        extractor: {
          prepare: async (request) => ({
            jobId: request.jobId,
            state: "ready",
            resultId: request.jobId,
            format: "srt",
            cueCount: 1,
            byteCount: resultBytes.length,
            sha256: sha256Hex(resultBytes),
          }),
          cancel: async () => "unknown",
          release: async () => undefined,
          shutdown: async () => undefined,
        },
        readResult: () => resultBytes,
        createId: () => id,
      });
    const first = build("player-A", firstBytes, "7a90a4e6-cc4f-4f59-99b7-8ff522f887ae");
    const second = build("player-B", secondBytes, "8b90a4e6-cc4f-4f59-99b7-8ff522f887af");
    const [left, right] = await Promise.all([
      first.prepare(
        {
          playerId: "player-A",
          mediaEpoch: 1,
          localPath: "/private/a.mkv",
          isNetworkResource: false,
        },
        { trackId: 7, origin: "embedded", codec: "ass", ffIndex: 3, title: "English" },
      ),
      second.prepare(
        {
          playerId: "player-B",
          mediaEpoch: 1,
          localPath: "/private/b.mkv",
          isNetworkResource: false,
        },
        { trackId: 8, origin: "embedded", codec: "ass", ffIndex: 4, title: "English" },
      ),
    ]);
    expect(left?.cues[0]?.sourceText).toBe("Hello");
    expect(right?.cues[0]?.sourceText).toBe("Other");
    first.invalidateForSelection(
      {
        playerId: "player-A",
        mediaEpoch: 1,
        localPath: "/private/a.mkv",
        isNetworkResource: false,
      },
      { trackId: 9, origin: "embedded", codec: "ass", ffIndex: 5, title: "English" },
    );
    expect(first.source).toBeNull();
    expect(second.source?.cues[0]?.sourceText).toBe("Other");
  });

  it("does not call the Provider or show an overlay for unsupported and unavailable sources", async () => {
    const provider = new RecordingProvider();
    const overlay = new RecordingOverlay();
    const controller = new PlaybackController({
      playerId: "player-A",
      provider,
      overlay,
      targetLanguage: "zh-Hans",
    });
    controller.setEnabled(true);
    const base = {
      playerId: "player-A",
      mediaEpoch: 1,
      mediaUrl: "file:///private/media/movie.mkv",
      isNetworkResource: false,
      selectedTrackId: 7,
    };
    for (const codec of ["hdmv_pgs_subtitle", "dvd_subtitle", "dvb_subtitle", "unknown"]) {
      const selection = classifySubtitleSelection({
        ...base,
        tracks: [
          {
            type: "sub",
            id: 7,
            selected: true,
            "main-selection": 0,
            external: false,
            codec,
            "ff-index": 3,
          },
        ],
      });
      expect(selection).toMatchObject({ kind: "unsupported", state: "unsupportedType" });
      controller.tick(1_000);
    }
    controller.tick(1_000);
    await controller.whenIdle();
    expect(provider.requests).toHaveLength(0);
    expect(overlay.frames).toHaveLength(0);
    expect(controller.status).toBe("waitingForSubtitle");
  });
});
