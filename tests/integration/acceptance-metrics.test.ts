import { translateCorpusSample } from "../helpers/language-translation.js";
import { afterEach, describe, expect, it } from "vitest";
import { PlaybackSession } from "../../src/app/playback-session.js";
import { classifySubtitleSelection } from "../../src/adapters/iina/subtitle-source.js";
import { ProviderSimulator } from "../helpers/provider-server.js";
import { readFileSync, writeFileSync } from "node:fs";
import {
  calibrateLanguageDetection,
  requiresAccurateCandidate,
} from "../helpers/language-calibration.js";
import { detectSubtitleLanguage } from "../../src/subtitles/language-detection.js";
import { shouldTranslate } from "../../src/domain/language.js";
import {
  corpusHash,
  evaluationOutcome,
  loadFrozenCorpora,
  summarizeCorpus,
  verifyDetectorConfiguration,
  type CorpusSplit,
  type EvaluationRecord,
} from "../helpers/language-corpus.js";

const simulators: ProviderSimulator[] = [];
afterEach(async () => Promise.all(simulators.splice(0).map((server) => server.close())));

describe("controlled provider acceptance runner", () => {
  it("evaluates language detection against admitted, frozen natural subtitles", async () => {
    const mode = process.env.SUBTANDEM_LANGUAGE_CORPUS ?? "acceptance";
    expect(["calibration", "acceptance"]).toContain(mode);
    const corpora = loadFrozenCorpora();
    const corpus = corpora[mode as CorpusSplit];
    if (process.env.SUBTANDEM_LANGUAGE_CALIBRATE === "1") {
      expect(mode).toBe("calibration");
      const grid = calibrateLanguageDetection(corpus);
      writeFileSync(
        "docs/validation/language-calibration-grid.json",
        JSON.stringify(grid, null, 2) + "\n",
      );
      console.info(
        JSON.stringify({
          configurationCount: grid.configurationCount,
          behaviorQualifiedCount: grid.behaviorQualifiedCount,
          preferredParameters: grid.preferredParameters,
        }),
      );
      expect(grid.preferredParameters).not.toBeNull();
      return;
    }
    const configuration =
      mode === "acceptance" ? verifyDetectorConfiguration() : "calibration-unfrozen";
    const build = corpusHash(
      readFileSync(new URL("../../src/subtitles/language-detection.ts", import.meta.url)),
    );
    const records: EvaluationRecord[] = [];
    const directions: Array<{ sampleId: string; correct: boolean }> = [];
    const failures: string[] = [];
    for (const sample of corpus.samples) {
      const start = performance.now();
      const result = detectSubtitleLanguage(sample.cues);
      const elapsedMs = performance.now() - start;
      const target = sample.truth.expectedLanguageIds.some((id) => !shouldTranslate(id, "en"))
        ? "ja"
        : "en";
      const expected = sample.truth.expectedLanguageIds[0];
      const metadata = [expected, undefined, expected === "en" ? "ja" : "en"];
      let providerCalls = 0;
      for (const [index, tag] of metadata.entries()) {
        const actual = await translateCorpusSample(sample, target, tag);
        providerCalls += actual.calls;
        if (JSON.stringify(actual.result) !== JSON.stringify(result))
          failures.push(`${sample.sampleId}:metadata-result`);
        if (!actual.gatesPassed) failures.push(`${sample.sampleId}:translation-gates`);
        if (sample.primary && sample.truth.positive && index > 0)
          directions.push({
            sampleId: sample.sampleId,
            correct: actual.calls > 0 && actual.correctDirection,
          });
      }
      if (result.state === "reliable") {
        const equal = await translateCorpusSample(sample, result.languageId, undefined);
        if (equal.calls !== 0 || !equal.gatesPassed)
          failures.push(`${sample.sampleId}:equivalence`);
      }
      for (const gate of ["disabled", "unselected", "invalidated-profile"] as const) {
        const blocked = await translateCorpusSample(sample, target, undefined, gate);
        if (blocked.calls !== 0 || !blocked.gatesPassed)
          failures.push(`${sample.sampleId}:${gate}`);
      }
      const outcome = evaluationOutcome(sample, result);
      records.push({ sampleId: sample.sampleId, result, outcome, elapsedMs, providerCalls });
      if (
        sample.truth.behavior === "candidate"
          ? result.state !== "reliable"
          : result.state !== sample.truth.behavior
      )
        failures.push(`${sample.sampleId}:behavior`);
      const requiredAccuracy = requiresAccurateCandidate(sample);
      if (requiredAccuracy && sample.truth.behavior === "candidate" && outcome !== "correct")
        failures.push(`${sample.sampleId}:required-accuracy`);
      if (
        sample.tags.includes("supported-tie") &&
        Array.from({ length: 3 }, () => detectSubtitleLanguage(sample.cues)).some(
          (repeated) => JSON.stringify(repeated) !== JSON.stringify(result),
        )
      )
        failures.push(`${sample.sampleId}:unstable-tie`);
    }
    const strata = summarizeCorpus(corpus, records);
    const byId = new Map(records.map((record) => [record.sampleId, record]));
    const variants = corpus.samples
      .filter((sample) => sample.kind === "variant" && !sample.tags.includes("translation"))
      .map((sample) => ({
        sampleId: sample.sampleId,
        consistent:
          JSON.stringify(byId.get(sample.sampleId)!.result) ===
          JSON.stringify(byId.get(sample.derivedFrom[0]!)!.result),
      }));
    const report = {
      mode,
      corpus: corpus.hashes,
      configuration,
      build,
      records,
      strata,
      variants: {
        denominator: variants.length,
        consistent: variants.filter((v) => v.consistent).length,
        records: variants,
      },
      metadataDirections: {
        denominator: directions.length,
        correct: directions.filter((d) => d.correct).length,
      },
      failures,
    };
    if (process.env.SUBTANDEM_LANGUAGE_REPORT === "1")
      writeFileSync(
        `docs/validation/language-detection-${mode}.json`,
        JSON.stringify(report, null, 2) + "\n",
      );
    console.info(JSON.stringify(report));
    for (const name of ["positive", "positive:short", "positive:medium", "positive:long"]) {
      const group = strata.find((entry) => entry.stratum === name);
      expect(group, name).toBeDefined();
      expect(group!.denominator).toBeGreaterThan(0);
      expect(group!.counts.correct / group!.denominator, name).toBeGreaterThanOrEqual(0.95);
      expect(
        (group!.counts.unknown + group!.counts.unsupported) / group!.denominator,
        name,
      ).toBeLessThanOrEqual(0.05);
    }
    for (const group of strata)
      expect(Object.values(group.counts).reduce((a, b) => a + b, 0)).toBe(group.denominator);
    expect(directions.length).toBeGreaterThan(0);
    expect(
      directions.filter((direction) => direction.correct).length / directions.length,
    ).toBeGreaterThanOrEqual(0.95);
    expect(variants.length).toBeGreaterThan(0);
    expect(variants.every((variant) => variant.consistent)).toBe(true);
    expect(failures).toEqual([]);
  }, 600_000);

  it("classifies every synthetic selected track with 100% exact identity", () => {
    const cases = Array.from({ length: 30 }, (_, index) => {
      const external = index >= 26;
      const unsupported = index >= 20 && index < 23;
      const codec = unsupported
        ? ["hdmv_pgs_subtitle", "dvd_subtitle", "dvb_subtitle"][index - 20]
        : ["subrip", "ass", "ssa", "mov_text"][index % 4];
      return {
        expected: external ? "external" : unsupported ? "unsupported" : "embedded",
        snapshot: {
          playerId: `player-${index}`,
          mediaEpoch: 1,
          mediaUrl: `/private/synthetic-${index}.mkv`,
          isNetworkResource: false,
          selectedTrackId: index + 1,
          tracks: [
            {
              type: "sub",
              id: index + 1,
              selected: true,
              "main-selection": 0,
              external,
              codec,
              "ff-index": index,
              "src-id": index + 100,
            },
          ],
        },
      };
    });
    const matches = cases.filter(
      ({ expected, snapshot }) => classifySubtitleSelection(snapshot).kind === expected,
    );
    expect(matches).toHaveLength(cases.length);
  });

  it("rejects stale results across 20 iterations of every lifecycle boundary", () => {
    const boundaries: Array<(session: PlaybackSession) => void> = [
      (session) => session.onTrackChanged(),
      (session) => session.onFileChanged(),
      (session) => session.onFileChanged(),
      (session) => session.setEnabled(false),
      (session) => session.close(),
      (session) => session.onSeek(30_000),
    ];
    let staleAccepted = 0;
    for (const boundary of boundaries) {
      for (let iteration = 0; iteration < 20; iteration += 1) {
        const session = new PlaybackSession(`player-${iteration}`, `session-${iteration}`);
        const fingerprint = session.fingerprint();
        boundary(session);
        if (session.accepts(fingerprint)) staleAccepted += 1;
      }
    }
    for (let iteration = 0; iteration < 20; iteration += 1) {
      const left = new PlaybackSession(`left-${iteration}`, `session-${iteration}`);
      const right = new PlaybackSession(`right-${iteration}`, `session-${iteration}`);
      if (right.accepts(left.fingerprint())) staleAccepted += 1;
    }
    expect(staleAccepted).toBe(0);
  });

  it("emits temporary failure, Retry-After, malformed and successful responses deterministically", async () => {
    const simulator = new ProviderSimulator();
    simulators.push(simulator);
    simulator.enqueue({
      status: 503,
      headers: { "Retry-After": "3", "X-Request-ID": "req-1" },
      body: { error: "temporary" },
    });
    simulator.enqueue({ status: 200, body: "not-json" });
    simulator.enqueue({
      status: 200,
      delayMs: 10,
      body: { translations: [{ id: "c1", text: "ok" }] },
    });
    await simulator.start();

    const first = await fetch(`${simulator.url}/translate`, {
      method: "POST",
      body: '{"items":[]}',
    });
    expect(first.status).toBe(503);
    expect(first.headers.get("retry-after")).toBe("3");
    const malformed = await fetch(`${simulator.url}/translate`, { method: "POST", body: "{}" });
    await expect(malformed.json()).rejects.toThrow();
    const success = await fetch(`${simulator.url}/translate`, { method: "POST", body: "{}" });
    await expect(success.json()).resolves.toEqual({ translations: [{ id: "c1", text: "ok" }] });
    expect(simulator.calls).toHaveLength(3);
  });
});
