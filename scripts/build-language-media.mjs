import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const corpus = "tests/fixtures/languages";
const manifest = JSON.parse(readFileSync(`${corpus}/calibration.json`, "utf8"));
const sample = (id) => manifest.samples.find((item) => item.sampleId === `calibration-${id}`);
const output = "tests/fixtures/media/language";
mkdirSync(output, { recursive: true });
const ffmpeg = (args) =>
  execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", ...args], { stdio: "pipe" });
const source = (id) => resolve(corpus, sample(id).file);
const ssa = (input, destination) => {
  const header = readFileSync("tests/fixtures/media/source/sample.ssa", "utf8").split(
    "Dialogue:",
  )[0];
  const time = (value) =>
    value
      .replace(/^(\d\d):/, (_, hours) => `${Number(hours)}:`)
      .replace(",", ".")
      .slice(0, -1);
  const lines = readFileSync(input, "utf8")
    .trim()
    .split(/\n\s*\n/)
    .map((block) => {
      const [, times, ...text] = block.split("\n");
      const [start, end] = times.split(" --> ");
      return `Dialogue: Marked=0,${time(start)},${time(end)},Default,,0,0,0,,${text.join("\\N")}`;
    });
  writeFileSync(destination, header + lines.join("\n") + "\n");
};
for (const id of ["de-eleven", "en-6"]) {
  ffmpeg(["-i", source(id), "-c:s", "ass", `${output}/${id}.ass`]);
  ssa(source(id), `${output}/${id}.ssa`);
}
const entries = [];
for (const codec of ["subrip", "ass", "ssa", "mov_text"]) {
  const input = (id) =>
    codec === "ass" || codec === "ssa" ? `${output}/${id}.${codec}` : source(id);
  for (const [label, tag] of [
    ["correct", "deu"],
    ["missing", null],
    ["wrong", "eng"],
  ]) {
    const file = `${output}/${codec}-${label}.${codec === "mov_text" ? "mp4" : "mkv"}`;
    ffmpeg([
      "-f",
      "lavfi",
      "-i",
      "testsrc2=size=96x54:rate=1:duration=300",
      "-i",
      input("en-6"),
      "-i",
      input("de-eleven"),
      "-map",
      "0:v",
      "-map",
      "1:0",
      "-map",
      "2:0",
      "-c:v",
      "libx264",
      "-preset",
      "ultrafast",
      "-crf",
      "42",
      "-c:s",
      codec === "ssa" || codec === "ass" ? "copy" : codec === "subrip" ? "srt" : "mov_text",
      "-metadata:s:s:0",
      "language=eng",
      "-metadata:s:s:1",
      `language=${tag ?? "und"}`,
      "-disposition:s:0",
      "0",
      "-disposition:s:1",
      "default",
      file,
    ]);
    entries.push({
      id: `language-${codec}-${label}`,
      sampleId: "calibration-de-eleven",
      distractorSampleId: "calibration-en-6",
      file,
      codec,
      ffIndex: 2,
      tag,
      sha256: createHash("sha256").update(readFileSync(file)).digest("hex"),
    });
  }
}
writeFileSync(
  `${corpus}/media.json`,
  JSON.stringify(
    {
      schemaVersion: 1,
      corpusVersion: manifest.version,
      generator: "scripts/build-language-media.mjs",
      entries,
    },
    null,
    2,
  ) + "\n",
);
if (process.argv.includes("--stress")) {
  const stress = "build/language-media";
  mkdirSync(stress, { recursive: true });
  const text = readFileSync(source("de-eleven"), "utf8")
    .trim()
    .split(/\n\s*\n/)
    .map((block) => block.split("\n").slice(2).join("\n"));
  const time = (ms) =>
    `${String(Math.floor(ms / 3600000)).padStart(2, "0")}:${String(Math.floor(ms / 60000) % 60).padStart(2, "0")}:${String(Math.floor(ms / 1000) % 60).padStart(2, "0")},${String(ms % 1000).padStart(3, "0")}`;
  const cues = Array.from(
    { length: 20000 },
    (_, index) =>
      `${index + 1}\n${time(index * 720)} --> ${time(index * 720 + 600)}\n${text[index % text.length]}\n`,
  );
  writeFileSync(`${stress}/stress-20000.srt`, cues.join("\n"));
  ffmpeg([
    "-f",
    "lavfi",
    "-i",
    "testsrc2=size=160x90:rate=2:duration=14400",
    "-i",
    `${stress}/stress-20000.srt`,
    "-c:v",
    "libx264",
    "-preset",
    "ultrafast",
    "-crf",
    "40",
    "-c:s",
    "srt",
    "-metadata:s:s:0",
    "language=deu",
    `${stress}/stress-20000.mkv`,
  ]);
}
process.stdout.write(
  JSON.stringify({
    generatedMedia: entries.length,
    stressGenerated: process.argv.includes("--stress"),
  }) + "\n",
);
