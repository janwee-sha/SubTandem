import { afterEach, describe, expect, it, vi } from "vitest";
import {
  LanguageDetectionCoordinator,
  type LanguageDetectionInput,
} from "../../src/app/language-detection.js";
import {
  createLanguageDetectionWork,
  type LanguageDetectionResult,
  type LanguageDetectionStep,
} from "../../src/subtitles/language-detection.js";
import { loadLanguageCorpus } from "../helpers/language-corpus.js";

const cues = loadLanguageCorpus("calibration").tracks.find(
  (sample) => sample.record.languageTruth.languageId === "en",
)!.cues;
const input: LanguageDetectionInput = {
  playerId: "p",
  sessionId: "s",
  sessionEpoch: 1,
  mediaEpoch: 1,
  trackIdentity: "track",
  contentHash: "body",
  sourceReadyAt: 0,
  cues,
};
const step: LanguageDetectionStep = { phase: "sampling", processedCues: 1, processedCodeUnits: 10 };
afterEach(() => vi.useRealTimers());

describe("language detection coordinator", () => {
  it("executes real slices between yields and commits one terminal result", async () => {
    let workCalls = 0;
    let yields = 0;
    const results: LanguageDetectionResult[] = [];
    const coordinator = new LanguageDetectionCoordinator({
      now: () => 0,
      yieldControl: async () => {
        yields++;
      },
      createWork: (cues) => {
        const work = createLanguageDetectionWork(cues);
        return {
          next: () => {
            workCalls++;
            return work.next();
          },
        };
      },
    });
    await coordinator.start(input, (result) => results.push(result));
    expect(results.length).toBe(1);
    expect(results[0]).toMatchObject({ state: "reliable", languageId: "en" });
    expect(workCalls).toBeGreaterThan(1);
    expect(yields).toBe(workCalls - 1);
    await coordinator.start({ ...input, sourceReadyAt: 100 }, (result) => results.push(result));
    expect(results.length).toBe(1);
    expect(coordinator.currentAttempt).toBeNull();
  });
  it.each([449, 450, 451, 499])(
    "checks the original internal deadline at %i ms before starting work",
    async (now) => {
      let calls = 0;
      const results: LanguageDetectionResult[] = [];
      const coordinator = new LanguageDetectionCoordinator({
        now: () => now,
        createWork: () => ({
          next: () => {
            calls++;
            return { done: true, value: { state: "reliable", languageId: "en" } };
          },
        }),
      });
      await coordinator.start(input, (result) => results.push(result));
      expect(calls).toBe(now < 450 ? 1 : 0);
      expect(results[0]).toMatchObject(
        now < 450 ? { state: "reliable" } : { state: "unknown", reason: "timeout" },
      );
    },
  );
  it("wakes at 450 ms independently of a never-completing yield", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const results: LanguageDetectionResult[] = [];
    let calls = 0;
    const coordinator = new LanguageDetectionCoordinator({
      yieldControl: () => new Promise(() => {}),
      createWork: () => ({
        next: () => {
          calls++;
          return { done: false, value: step };
        },
      }),
    });
    const completion = coordinator.start(input, (result) => results.push(result));
    await vi.advanceTimersByTimeAsync(449);
    expect(results.length).toBe(0);
    await vi.advanceTimersByTimeAsync(1);
    await completion;
    expect(results.length).toBe(1);
    expect(results[0]).toMatchObject({ state: "unknown", reason: "timeout" });
    expect(calls).toBe(1);
  });
  it("checks synchronous work crossing the deadline even when timer delivery is delayed", async () => {
    let now = 449;
    const results: LanguageDetectionResult[] = [];
    const coordinator = new LanguageDetectionCoordinator({
      now: () => now,
      createWork: () => ({
        next: () => {
          now = 510;
          return { done: true, value: { state: "reliable", languageId: "en" } };
        },
      }),
    });
    await coordinator.start(input, (result) => results.push(result));
    expect(results[0]).toMatchObject({ state: "unknown", reason: "timeout" });
    expect(now - input.sourceReadyAt).toBeGreaterThan(500);
  });
  it("turns synchronous and asynchronous failures into one safe error terminal", async () => {
    for (const phase of ["create", "step", "yield"]) {
      const results: LanguageDetectionResult[] = [];
      const coordinator = new LanguageDetectionCoordinator({
        now: () => 0,
        createWork: () => {
          if (phase === "create") throw new Error("private");
          return {
            next: () => {
              if (phase === "step") throw new Error("private");
              return { done: false, value: step };
            },
          };
        },
        yieldControl: async () => {
          throw new Error("private");
        },
      });
      await coordinator.start(input, (result) => results.push(result));
      expect(results.length).toBe(1);
      expect(results[0]).toMatchObject({ state: "unknown", reason: "error" });
      expect(JSON.stringify(results).includes("private")).toBe(false);
    }
  });
  it("preserves seek and stops old work for every full-owner boundary over 20 iterations", async () => {
    for (const change of [
      { playerId: "other" },
      { sessionId: "other" },
      { sessionEpoch: 2 },
      { mediaEpoch: 2 },
      { trackIdentity: "other" },
      { contentHash: "other" },
    ]) {
      for (let iteration = 0; iteration < 20; iteration++) {
        const releases: Array<() => void> = [];
        const accepted: string[] = [];
        let firstSteps = 0;
        let workIndex = 0;
        const coordinator = new LanguageDetectionCoordinator({
          now: () => 0,
          yieldControl: () => new Promise((resolve) => releases.push(resolve)),
          createWork: () => {
            const index = workIndex++;
            let count = 0;
            return {
              next: () => {
                if (index === 0) firstSteps++;
                return count++ === 0
                  ? { done: false, value: step }
                  : { done: true, value: { state: "reliable", languageId: "en" } };
              },
            };
          },
        });
        const first = coordinator.start(input, (result) => accepted.push(result.attemptId));
        coordinator.onSeek();
        const firstId = coordinator.currentAttempt!.attemptId;
        const second = coordinator.start({ ...input, ...change }, (result) =>
          accepted.push(result.attemptId),
        );
        releases.splice(0).forEach((release) => release());
        await Promise.all([first, second]);
        expect(firstSteps).toBe(1);
        expect(accepted.length).toBe(1);
        expect(accepted[0] === firstId).toBe(false);
      }
    }
  });
  it("invalidates pending work without waiting for or admitting its late result", async () => {
    const results: LanguageDetectionResult[] = [];
    const coordinator = new LanguageDetectionCoordinator({
      now: () => 0,
      yieldControl: () => new Promise(() => {}),
      createWork: () => ({ next: () => ({ done: false, value: step }) }),
    });
    const completion = coordinator.start(input, (result) => results.push(result));
    coordinator.invalidate();
    await completion;
    expect(results.length).toBe(0);
    expect(coordinator.currentAttempt).toBeNull();
  });
});
