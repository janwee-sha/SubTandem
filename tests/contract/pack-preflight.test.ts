import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const workspaces: string[] = [];
const helpers = ["subtandem-transport", "subtandem-subtitle-extractor", "subtandem-style-picker"];

afterEach(() => {
  for (const workspace of workspaces.splice(0)) rmSync(workspace, { recursive: true, force: true });
});

describe("package build preflight", () => {
  it("keeps the package native allowlist limited to the three non-UI helpers", () => {
    const pack = readFileSync(new URL("../../scripts/pack.sh", import.meta.url), "utf8");
    const verify = readFileSync(
      new URL("../../scripts/verify-package.sh", import.meta.url),
      "utf8",
    );

    expect(pack).toContain("subtandem-transport");
    expect(pack).toContain("subtandem-subtitle-extractor");
    expect(pack).toContain("subtandem-style-picker");
    expect(verify).toContain("EXPECTED_NATIVE");
    expect(pack).not.toMatch(/dist\/native\/(?:dialog|alert|confirmation)/i);
    expect(verify).not.toMatch(/dist\/native\/(?:dialog|alert|confirmation)/i);
  });

  it.each(helpers)(
    "preserves staging and the last artifact when %s is missing",
    (missingHelper) => {
      const workspace = mkdtempSync(join(tmpdir(), "subtandem-pack-preflight-"));
      workspaces.push(workspace);
      const put = (path: string, content: string, mode = 0o644): void => {
        const target = join(workspace, path);
        mkdirSync(dirname(target), { recursive: true });
        writeFileSync(target, content, { mode });
      };
      for (const file of [
        "Info.json",
        "README.md",
        "LICENSE",
        "THIRD_PARTY_NOTICES.txt",
        "dist/main.js",
        "dist/global.js",
        "dist/ui/sidebar.html",
        "dist/ui/overlay.html",
      ]) {
        put(file, "fixture");
      }
      for (const helper of helpers.filter((helper) => helper !== missingHelper)) {
        put(`dist/native/${helper}`, "native fixture", 0o755);
      }
      put("build/package/SubTandem/previous-stage", "previous verified stage");
      put("build/package/SubTandem-0.1.3.iinaplgz", "previous verified artifact");
      put("plugin-cli", "#!/bin/sh\nexit 99\n", 0o755);
      mkdirSync(join(workspace, "scripts"));
      for (const script of ["pack.sh", "verify-package.sh"]) {
        copyFileSync(
          new URL(`../../scripts/${script}`, import.meta.url),
          join(workspace, "scripts", script),
        );
      }

      const result = spawnSync("sh", [join(workspace, "scripts/pack.sh")], {
        cwd: workspace,
        env: { ...process.env, IINA_PLUGIN_BIN: join(workspace, "plugin-cli") },
        encoding: "utf8",
      });

      expect(result.status).toBe(1);
      expect(result.stderr).toContain(join(workspace, `dist/native/${missingHelper}`));
      expect(result.stderr).toContain("npm run build:native");
      expect(result.stderr).toContain("npm run build");
      expect(readFileSync(join(workspace, "build/package/SubTandem/previous-stage"), "utf8")).toBe(
        "previous verified stage",
      );
      expect(readFileSync(join(workspace, "build/package/SubTandem-0.1.3.iinaplgz"), "utf8")).toBe(
        "previous verified artifact",
      );
    },
  );
});
