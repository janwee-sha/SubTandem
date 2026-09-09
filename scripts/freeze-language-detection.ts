import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { DEFAULT_DETECTION_PARAMETERS } from "../src/subtitles/language-detection.js";
import {
  corpusHash,
  detectorConfigurationFiles,
  loadFrozenCorpora,
  verifyDetectorConfiguration,
} from "../tests/helpers/language-corpus.js";

const gridPath = "docs/validation/language-calibration-grid.json";
if (existsSync("docs/validation/language-detection-acceptance.json"))
  throw new Error("ACCEPTANCE_ALREADY_EXPOSED");
const behaviorPath = "docs/validation/language-detection-calibration.json";
const performancePath = "docs/validation/language-detection-node.json";
const read = (path: string) => JSON.parse(readFileSync(path, "utf8"));
const grid = read(gridPath);
const behavior = read(behaviorPath);
const performance = read(performancePath);
const corpus = loadFrozenCorpora().calibration;
const same = (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right);
if (
  !same(grid.preferredParameters, DEFAULT_DETECTION_PARAMETERS) ||
  grid.configurationCount !== 81 ||
  !same(grid.calibrationHashes, corpus.hashes)
)
  throw new Error("CALIBRATION_GRID_MISMATCH");
if (
  behavior.mode !== "calibration" ||
  !same(behavior.corpus, corpus.hashes) ||
  behavior.failures.length !== 0 ||
  behavior.records.length !== corpus.samples.length ||
  behavior.build !== corpusHash(readFileSync("src/subtitles/language-detection.ts"))
)
  throw new Error("CALIBRATION_BEHAVIOR_NOT_PASSED");
if (
  performance.firstCount < 40 ||
  performance.repeatCount < 40 ||
  performance.ordinaryReliableCount !== performance.firstCount + performance.repeatCount ||
  performance.firstP95Ms > 100 ||
  performance.repeatP95Ms > 50 ||
  performance.stepP99Ms > 16 ||
  performance.maxMs > 500
)
  throw new Error("CALIBRATION_PERFORMANCE_NOT_PASSED");
const calibrationReport = "docs/validation/language-calibration.json";
const evidence = [gridPath, behaviorPath, performancePath].map((file) => ({
  file,
  sha256: corpusHash(readFileSync(file)),
}));
const distribution = detectorConfigurationFiles();
writeFileSync(
  calibrationReport,
  JSON.stringify(
    {
      schemaVersion: 1,
      status: "qualified",
      parameters: DEFAULT_DETECTION_PARAMETERS,
      evidence,
      selectedRank: 1,
      behaviorQualifiedCount: grid.behaviorQualifiedCount,
    },
    null,
    2,
  ) + "\n",
);
writeFileSync(
  "tests/fixtures/languages/detector-config.json",
  JSON.stringify(
    {
      schemaVersion: 1,
      status: "frozen",
      frozenAt: new Date().toISOString(),
      parameters: DEFAULT_DETECTION_PARAMETERS,
      ...distribution,
      files: {
        ...distribution.files,
        ...Object.fromEntries(evidence.map(({ file, sha256 }) => [file, sha256])),
      },
      calibrationReport,
      calibrationReportSha256: corpusHash(readFileSync(calibrationReport)),
    },
    null,
    2,
  ) + "\n",
);
process.stdout.write(
  JSON.stringify({
    status: "frozen",
    configurationHash: verifyDetectorConfiguration(),
    parameters: DEFAULT_DETECTION_PARAMETERS,
  }) + "\n",
);
