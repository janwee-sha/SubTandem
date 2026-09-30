import { mkdtempSync, mkdirSync, writeFileSync, rmSync, copyFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { auditCredentialPackage } from "../../scripts/audit-credential-package.mjs";
describe("production credential package audit", () => {
  function fixture(run: (root: string) => void) {
    const root = mkdtempSync(join(tmpdir(), "credential-package-audit-"));
    try {
      mkdirSync(join(root, "dist"));
      for (const file of ["package.json", "Info.json", "THIRD_PARTY_NOTICES.txt"])
        copyFileSync(file, join(root, file));
      run(root);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }
  it.each(["CredentialHostProbe", "credential-write-observer", "synthetic-host-openai-key"])(
    "rejects %s in executable runtime bytes",
    (marker) =>
      fixture((root) => {
        writeFileSync(join(root, "dist/main.js"), marker);
        expect(() => auditCredentialPackage(root, root)).toThrow(/Test credential/);
      }),
  );
  it("rejects credential and development assets", () =>
    fixture((root) => {
      writeFileSync(join(root, "dist/credentials.json"), "{}");
      expect(() => auditCredentialPackage(root, root)).toThrow(/asset/);
    }));
  it("checks production versions before publication", () =>
    fixture((root) => {
      writeFileSync(join(root, "package.json"), '{"version":"0.0.0"}');
      expect(() => auditCredentialPackage(root, root)).toThrow(/mismatch/);
    }));
});
