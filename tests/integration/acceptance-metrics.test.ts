import { afterEach, describe, expect, it } from "vitest";
import { PlaybackSession } from "../../src/app/playback-session.js";
import { classifySubtitleSelection } from "../../src/adapters/iina/subtitle-source.js";
import { ProviderSimulator } from "../helpers/provider-server.js";
import { readFileSync } from "node:fs";
import { detectSubtitleLanguage } from "../../src/subtitles/language-detection.js";
import { loadLanguageCorpus, resolveCorpusFile } from "../helpers/language-corpus.js";
import { summarizeLanguageMetrics } from "../helpers/language-metrics.js";
import { loadSubtitleSource } from "../../src/subtitles/source.js";
import { LANGUAGE_DETECTION_PARAMETERS } from "../../src/subtitles/language-detection.js";

const simulators: ProviderSimulator[] = [];
afterEach(async () => Promise.all(simulators.splice(0).map((server) => server.close())));

describe("controlled provider acceptance runner", () => {
  it("meets the frozen independent-track language gates after parameter freeze", () => {
    const calibration = loadLanguageCorpus("calibration");
    const frozen = JSON.parse(
      readFileSync(resolveCorpusFile("calibration-result.json"), "utf8"),
    ) as { calibrationManifestHash: string; parameters: unknown };
    expect(frozen.calibrationManifestHash === calibration.manifest.manifestHash).toBe(true);
    expect(
      JSON.stringify(frozen.parameters) === JSON.stringify(LANGUAGE_DETECTION_PARAMETERS),
    ).toBe(true);
    const acceptance = loadLanguageCorpus("acceptance");
    const rows = acceptance.tracks.map(({ record, cues }) => ({
      record,
      result: detectSubtitleLanguage(cues),
    }));
    const summary = summarizeLanguageMetrics(rows);
    console.info(
      "language-acceptance",
      JSON.stringify({
        frozenRevision: acceptance.manifest.frozenRevision,
        manifestHash: acceptance.manifest.manifestHash,
        ...summary,
      }),
    );
    let differences = 0;
    for (const [index, { record }] of acceptance.tracks.entries()) {
      const bytes = readFileSync(resolveCorpusFile(record.file));
      for (const lang of [undefined, "xx-wrong", record.languageTruth.languageId ?? "ja"]) {
        const source = loadSubtitleSource(
          {
            id: 1,
            isExternal: true,
            title: `input.${record.format}`,
            ...(lang === undefined ? {} : { lang }),
          },
          bytes,
        );
        if (!source.ok) throw new Error("language-acceptance:parser");
        if (
          JSON.stringify(detectSubtitleLanguage(source.source.cues)) !==
          JSON.stringify(rows[index]!.result)
        )
          differences++;
      }
    }
    console.info("language-metadata", JSON.stringify({ tracks: rows.length, differences }));
    console.info(
      "language-designated-short",
      JSON.stringify(
        rows
          .filter(({ record }) => record.regressionId)
          .map(({ record, result }) => ({ sampleId: record.sampleId, result })),
      ),
    );
    expect(summary.overall.positive).toBeGreaterThanOrEqual(400);
    expect(summary.overall.correctRate).toBeGreaterThanOrEqual(0.95);
    expect(summary.overall.wrongRate).toBeLessThanOrEqual(0.01);
    expect(summary.overall.negativeReliableRate).toBeLessThanOrEqual(0.01);
    for (const row of rows.filter(({ record }) => record.regressionId))
      expect(
        row.result.state === "reliable" &&
          row.result.languageId === row.record.languageTruth.languageId,
        row.record.sampleId,
      ).toBe(true);
    expect(differences).toBe(0);
  });

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
