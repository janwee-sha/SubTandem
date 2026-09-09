import { readFileSync } from "node:fs";
import process from "node:process";
import { performance } from "node:perf_hooks";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";

const started = performance.now();
const { LanguageDetectionCoordinator } = await import(
  pathToFileURL(resolve(process.argv[2], "app/language-detection.js"))
);
const { loadSubtitleSource } = await import(
  pathToFileURL(resolve(process.argv[2], "subtitles/source.js"))
);
const importMs = performance.now() - started;
const manifest = JSON.parse(readFileSync("tests/fixtures/languages/calibration.json", "utf8"));
const names = ["calibration-de-eleven", "calibration-en-ass", "calibration-mixed-over-budget"];
const bodies = names.map((name) => {
  const sample = manifest.samples.find((item) => item.sampleId === name);
  if (!sample) throw new Error("Missing calibration workload");
  const loaded = loadSubtitleSource(
    { id: 1, isExternal: true, title: `sample.${sample.format}` },
    readFileSync(resolve("tests/fixtures/languages", sample.file)),
  );
  if (!loaded.ok) throw new Error("Invalid calibration workload");
  return loaded.source.cues;
});
const metrics = [];
const coordinator = new LanguageDetectionCoordinator({
  now: () => performance.now(),
  onMetrics: (value) => metrics.push(value),
});
const mode = process.argv[3];
const count = mode === "warm" ? 41 : 1;
for (let index = 0; index < count; index++) {
  const seed = Number(process.argv[4] ?? 0);
  const cues =
    mode === "stress"
      ? Array.from({ length: 20_000 }, (_, cueIndex) => ({
          ...bodies[0][cueIndex % bodies[0].length],
          id: `stress-${cueIndex}`,
          index: cueIndex,
          startMs: cueIndex * 720,
          endMs: cueIndex * 720 + 600,
        }))
      : bodies[(index + seed) % bodies.length];
  await coordinator.start(
    {
      playerId: "performance",
      mediaEpoch: index,
      trackIdentity: "calibration",
      contentHash: String(index),
      cues,
    },
    () => undefined,
  );
}
process.stdout.write(
  JSON.stringify({ importMs, metrics: mode === "warm" ? metrics.slice(1) : metrics }) + "\n",
);
