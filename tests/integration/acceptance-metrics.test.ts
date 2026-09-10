import { afterEach, describe, expect, it } from "vitest";
import { PlaybackSession } from "../../src/app/playback-session.js";
import { classifySubtitleSelection } from "../../src/adapters/iina/subtitle-source.js";
import { ProviderSimulator } from "../helpers/provider-server.js";
import { readFileSync } from "node:fs";
import { detectSubtitleLanguage } from "../../src/subtitles/language-detection.js";
import type { SubtitleCue } from "../../src/subtitles/types.js";

const simulators: ProviderSimulator[] = [];
afterEach(async () => Promise.all(simulators.splice(0).map((server) => server.close())));

describe("controlled provider acceptance runner", () => {
  it("keeps calibration and acceptance fixtures isolated with twenty cues per language", () => {
    const calibration = JSON.parse(
      readFileSync(new URL("../fixtures/languages/calibration.json", import.meta.url), "utf8"),
    ) as { source: string; cycles: number; languages: Array<{ templates: string[] }> };
    const acceptance = JSON.parse(
      readFileSync(new URL("../fixtures/languages/acceptance.json", import.meta.url), "utf8"),
    ) as { source: string; cycles: number; languages: Array<{ templates: string[] }> };
    expect(calibration.source).not.toBe(acceptance.source);
    for (const fixture of [calibration, acceptance]) {
      expect(fixture.languages.length).toBeGreaterThanOrEqual(20);
      for (const language of fixture.languages)
        expect(language.templates.length * fixture.cycles).toBeGreaterThanOrEqual(20);
    }
  });

  it("meets frozen language accuracy, metadata-conflict and false-reliable gates", () => {
    const fixture = JSON.parse(
      readFileSync(new URL("../fixtures/languages/acceptance.json", import.meta.url), "utf8"),
    ) as {
      cycles: number;
      languages: Array<{
        id: string;
        trackLanguage: string;
        templates: string[];
      }>;
      unreliable: Array<{ id: string; expected: "unknown" | "unsupported"; templates: string[] }>;
    };
    const expand = (templates: string[], cycles: number): SubtitleCue[] =>
      Array.from({ length: cycles }, (_, cycle) =>
        templates.map((text, index): SubtitleCue => ({
          id: `${cycle}-${index}`,
          index: cycle * templates.length + index,
          startMs: (cycle * templates.length + index) * 1_000,
          endMs: (cycle * templates.length + index) * 1_000 + 900,
          sourceText: `${text} ${cycle + 1}`,
          normalizedText: `${text} ${cycle + 1}`,
        })),
      ).flat();
    const results = fixture.languages.map((language) => ({
      expected: language.id,
      metadataConflict: language.trackLanguage !== language.id,
      result: detectSubtitleLanguage(expand(language.templates, fixture.cycles)),
    }));
    const correct = results.filter(
      ({ expected, result }) => result.state === "reliable" && result.languageId === expected,
    ).length;
    const conflictCorrect = results.filter(
      ({ expected, metadataConflict, result }) =>
        metadataConflict && result.state === "reliable" && result.languageId === expected,
    ).length;
    const conflicts = results.filter(({ metadataConflict }) => metadataConflict).length;
    expect(correct / results.length, JSON.stringify(results)).toBeGreaterThanOrEqual(0.95);
    expect(conflictCorrect / conflicts).toBeGreaterThanOrEqual(0.95);
    const unreliableResults = fixture.unreliable.map(({ id, templates, expected }) => {
      const repeats = Math.max(5, 20 / templates.length);
      const windowed = templates.flatMap((text, templateIndex) =>
        Array.from({ length: repeats }, (_, cycle): SubtitleCue => ({
          id: `${templateIndex}-${cycle}`,
          index: templateIndex * repeats + cycle,
          startMs: (templateIndex * repeats + cycle) * 1_000,
          endMs: (templateIndex * repeats + cycle) * 1_000 + 900,
          sourceText: `${text} ${cycle + 1}`,
          normalizedText: `${text} ${cycle + 1}`,
        })),
      );
      const result = detectSubtitleLanguage(windowed);
      return { id, expected, result };
    });
    const falseReliable = unreliableResults.filter(
      ({ expected, result }) => result.state === "reliable" || result.state !== expected,
    ).length;
    expect(falseReliable, JSON.stringify(unreliableResults)).toBe(0);
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
