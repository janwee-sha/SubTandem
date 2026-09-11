import { expect, it } from "vitest";
import {
  diagnoseLanguageDetection,
  writeLanguageDiagnosis,
} from "../helpers/language-diagnosis.js";

it.skipIf(process.env.SUBTANDEM_LANGUAGE_DIAGNOSIS !== "1")(
  "records calibration failures and controlled ablations without evaluating the holdout",
  () => {
    const report = diagnoseLanguageDetection();
    writeLanguageDiagnosis(report);
    console.info(
      "language-diagnosis",
      JSON.stringify({
        ...report.summary.overall,
        ablations: report.ablations,
        rejectedLetters: report.rejectedLetters,
      }),
    );
    expect(report.evidenceAccountingValid).toBe(true);
  },
  120_000,
);
