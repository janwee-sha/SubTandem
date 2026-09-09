import { describe, expect, it } from "vitest";
import { LanguageDetectionCoordinator } from "../../src/app/language-detection.js";
import { createLanguageDetectionWork } from "../../src/subtitles/language-detection.js";
import { loadFrozenCorpora } from "../helpers/language-corpus.js";
import { PlaybackController } from "../../src/app/controller.js";
import { RecordingProvider } from "../helpers/fake-provider.js";
const cues = loadFrozenCorpora().calibration.samples.find(
  (s) => s.sampleId === "calibration-de-eleven",
)!.cues;
const input = { playerId: "p", mediaEpoch: 1, trackIdentity: "1", contentHash: "a", cues };

describe("language detection coordinator", () => {
  it.each(
    ["scan", "sample", "classify", "aggregate"].flatMap((phase) =>
      ["change-track", "change-media", "body-change", "disable", "close"].map((event) => ({
        phase,
        event,
      })),
    ),
  )("discards real $phase work on $event before any Provider request", async ({ phase, event }) => {
    const provider = new RecordingProvider();
    const controller = new PlaybackController({
      playerId: "p",
      provider,
      overlay: { show: () => undefined, clear: () => undefined },
      targetLanguage: "ja",
      requiresProviderSelection: true,
    });
    controller.setProviderSelection({
      profileId: "phase-profile",
      revision: 1,
      endpointFingerprint: "local",
      kind: "openai",
    });
    controller.setSource({ cues, language: null, contentHash: "a", format: "srt" });
    let currentPhase = "";
    let disposed = false;
    let cancelled = false;
    let commits = 0;
    const coordinator = new LanguageDetectionCoordinator({
      createWork: (body) => {
        const work = createLanguageDetectionWork(body);
        return {
          next: () => {
            const step = work.next();
            if (!step.done) currentPhase = step.value.phase;
            return step;
          },
          dispose: () => {
            disposed = true;
            work.dispose();
            expect(work.next()).toEqual({ done: true, value: { state: "unknown" } });
          },
        };
      },
      yieldControl: async () => {
        if (currentPhase !== phase || cancelled) return;
        cancelled = true;
        coordinator.invalidate();
        if (event === "close") controller.close();
        else if (event === "disable") controller.setEnabled(false);
        else if (event === "change-media") controller.endFile();
        else controller.setSource(null);
      },
    });
    await coordinator.start(input, (result) => {
      commits++;
      controller.setLanguageDetection(
        result.state === "reliable" ? { languageId: result.languageId } : result.state,
      );
    });
    controller.tick(cues[0]!.startMs);
    await controller.whenIdle();
    expect(cancelled).toBe(true);
    expect(disposed).toBe(true);
    expect(commits).toBe(0);
    expect(provider.requests).toEqual([]);
    expect(coordinator.currentAttempt).toBeNull();
    controller.close();
  });
  it("yields between real scans and classifications and releases completed work", async () => {
    const events: string[] = [];
    let disposed = false;
    const coordinator = new LanguageDetectionCoordinator({
      yieldControl: async () => {
        events.push("yield");
      },
      createWork: (c) => {
        const work = createLanguageDetectionWork(c, {
          classifier: () => {
            events.push("classify");
            return [["deu", 1]];
          },
        });
        return {
          next: () => {
            events.push("step");
            return work.next();
          },
          dispose: () => {
            disposed = true;
            work.dispose();
          },
        };
      },
    });
    await coordinator.start(input, (r) => events.push(r.state));
    expect(events.indexOf("step")).toBeLessThan(events.indexOf("yield"));
    expect(events.indexOf("yield")).toBeLessThan(events.indexOf("classify"));
    expect(events.at(-1)).toBe("reliable");
    expect(disposed).toBe(true);
    expect(coordinator.currentAttempt).toBeNull();
  });
  it.each(["playerId", "mediaEpoch", "trackIdentity", "contentHash", "attemptId"])(
    "rejects stale work when %s changes",
    async (field) => {
      const releases: Array<() => void> = [],
        accepted: string[] = [];
      const coordinator = new LanguageDetectionCoordinator({
        yieldControl: () => new Promise<void>((r) => releases.push(r)),
      });
      const first = coordinator.start(input, (r) => accepted.push(r.contentHash));
      const updated = {
        ...input,
        ...(field === "mediaEpoch"
          ? { mediaEpoch: 2 }
          : field === "attemptId"
            ? {}
            : { [field]: "changed" }),
      };
      const second = coordinator.start(updated, (r) => accepted.push(r.contentHash));
      for (let i = 0; i < 40; i++) {
        releases.splice(0).forEach((r) => r());
        await Promise.resolve();
      }
      await Promise.all([first, second]);
      expect(accepted).toEqual([updated.contentHash]);
    },
  );
  it("checks the deadline before and after actual work and commits timeout exactly once", async () => {
    let now = 0,
      calls = 0;
    const results: string[] = [];
    const coordinator = new LanguageDetectionCoordinator({
      now: () => now,
      yieldControl: async () => {
        now += 150;
      },
      createWork: (c) =>
        createLanguageDetectionWork(c, {
          classifier: () => {
            calls++;
            return [["deu", 1]];
          },
        }),
    });
    await coordinator.start(input, (r) => results.push(r.state));
    expect(results).toEqual(["unknown"]);
    expect(calls).toBeGreaterThan(0);
    expect(coordinator.currentAttempt).toBeNull();
  });
  it("does not begin another work step when the remaining budget is insufficient", async () => {
    let now = 0,
      steps = 0;
    const results: string[] = [];
    const coordinator = new LanguageDetectionCoordinator({
      now: () => now,
      yieldControl: async () => {
        now = 490;
      },
      createWork: (c) => {
        const work = createLanguageDetectionWork(c);
        return {
          next: () => {
            steps++;
            return work.next();
          },
          dispose: () => work.dispose(),
        };
      },
    });
    await coordinator.start(input, (r) => results.push(r.state));
    expect(steps).toBe(1);
    expect(results).toEqual(["unknown"]);
  });
  it.each(["change-track", "change-media", "body-change", "disable", "close"])(
    "invalidates %s during a pending step without committing",
    async () => {
      const releases: Array<() => void> = [],
        results: string[] = [];
      let disposed = false;
      const coordinator = new LanguageDetectionCoordinator({
        yieldControl: () => new Promise<void>((r) => releases.push(r)),
        createWork: (c) => {
          const work = createLanguageDetectionWork(c);
          return {
            next: () => work.next(),
            dispose: () => {
              disposed = true;
              work.dispose();
            },
          };
        },
      });
      const running = coordinator.start(input, (r) => results.push(r.state));
      coordinator.invalidate();
      expect(disposed).toBe(true);
      releases.splice(0).forEach((r) => r());
      await running;
      expect(results).toEqual([]);
    },
  );
  it("keeps seek and independent windows isolated and reports only safe timing fields", async () => {
    const metrics: unknown[] = [];
    const first = new LanguageDetectionCoordinator({
        yieldControl: async () => {},
        onMetrics: (m) => metrics.push(m),
      }),
      second = new LanguageDetectionCoordinator({ yieldControl: async () => {} });
    const states: string[] = [];
    first.onSeek();
    await Promise.all([
      first.start(input, (r) => states.push(r.state)),
      second.start({ ...input, playerId: "other" }, (r) => states.push(r.state)),
    ]);
    expect(states).toEqual(["reliable", "reliable"]);
    expect(metrics).toHaveLength(1);
    expect(Object.keys(metrics[0] as object).sort()).toEqual([
      "elapsedMs",
      "kind",
      "state",
      "stepDurationsMs",
    ]);
    expect(JSON.stringify(metrics)).not.toMatch(
      /languageId|contentHash|trackIdentity|cue|playerId/,
    );
  });
  it("closes scheduling and work exceptions without leaking error text", async () => {
    for (const options of [
      {
        yieldControl: async () => {
          throw Error("private");
        },
      },
      {
        createWork: () => {
          throw Error("private");
        },
      },
    ]) {
      const results: unknown[] = [];
      const c = new LanguageDetectionCoordinator(options);
      await c.start(input, (r) => results.push(r));
      expect(results).toEqual([
        { state: "unknown", contentHash: "a", attemptId: "language-detection-1" },
      ]);
    }
  });
});
