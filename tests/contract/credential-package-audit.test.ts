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
  it.each(["dist/fixtures/recovery.json", "dist/@data/credentials.json", "dist/recovery.json"])(
    "rejects recovery state in %s",
    (name) =>
      fixture((root) => {
        const path = join(root, name);
        mkdirSync(join(path, ".."), { recursive: true });
        writeFileSync(
          path,
          '{"formatVersion":2,"credentials":{"apiKey":"synthetic-recovery-private-key"}}',
        );
        expect(() => auditCredentialPackage(root, root)).toThrow(/asset/);
      }),
  );
  it("checks production versions before publication", () =>
    fixture((root) => {
      writeFileSync(join(root, "package.json"), '{"version":"0.0.0"}');
      expect(() => auditCredentialPackage(root, root)).toThrow(/mismatch/);
    }));
});

describe("localized production package audit", () => {
  it("accepts the signed app and rejects probe bytes and manifest localization changes", async () => {
    const { nativePackageFixture } = await import("../helpers/native-package-fixture.js");
    const { readFileSync } = await import("node:fs");
    const fixture = nativePackageFixture();
    try {
      auditCredentialPackage(fixture.root, process.cwd());
      writeFileSync(join(fixture.root, "dist/main.js"), "CredentialHostProbe");
      expect(() => auditCredentialPackage(fixture.root, process.cwd())).toThrow(/Test credential/);
      writeFileSync(join(fixture.root, "dist/main.js"), "");
      const info = JSON.parse(readFileSync(join(fixture.root, "Info.json"), "utf8"));
      info.localized.he.description = "unexpected";
      writeFileSync(join(fixture.root, "Info.json"), JSON.stringify(info));
      expect(() => auditCredentialPackage(fixture.root, process.cwd())).toThrow(/manifest differs/);
    } finally {
      fixture.cleanup();
    }
  });
});
