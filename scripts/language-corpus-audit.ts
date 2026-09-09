import { existsSync } from "node:fs";
import { auditCorpusDrafts, loadFrozenCorpora } from "../tests/helpers/language-corpus.js";

const reports = auditCorpusDrafts();
const frozen = existsSync(new URL("../tests/fixtures/languages/freeze.json", import.meta.url));
if (frozen) loadFrozenCorpora();
console.log(
  JSON.stringify(
    {
      status: reports.some((report) => report.pendingReview.length > 0)
        ? "pending-developer-review"
        : frozen
          ? "frozen"
          : "review-records-present",
      frozen,
      reports: reports.map(({ pendingReview, ...report }) => ({
        ...report,
        pendingReviewCount: pendingReview.length,
        ...(process.argv.includes("--list-pending") ? { pendingReview } : {}),
      })),
    },
    null,
    2,
  ),
);
if (reports.some((report) => report.proposedCoverageIssues.length > 0)) process.exitCode = 1;
