import { registerHooks } from "node:module";
import process from "node:process";
import { performance } from "node:perf_hooks";
registerHooks({
  resolve(specifier, context, nextResolve) {
    try {
      return nextResolve(specifier, context);
    } catch (error) {
      if (specifier.startsWith(".") && specifier.endsWith(".js"))
        return nextResolve(specifier.slice(0, -3) + ".ts", context);
      throw error;
    }
  },
});
const { languagePerformanceCues, LANGUAGE_PERFORMANCE_CASES } =
  await import("./language-performance-cases.ts");
const kind = process.argv[2];
if (!LANGUAGE_PERFORMANCE_CASES.includes(kind)) throw new Error("language-performance:case");
const cues = languagePerformanceCues(kind);
const started = performance.now();
const { createLanguageDetectionWork } = await import("../../src/subtitles/language-detection.ts");
const work = createLanguageDetectionWork(cues);
const slices = [];
let terminal;
for (;;) {
  const before = performance.now();
  const result = work.next();
  slices.push(performance.now() - before);
  if (result.done) {
    terminal = result.value.state;
    break;
  }
}
process.stdout.write(JSON.stringify({ durationMs: performance.now() - started, slices, terminal }));
