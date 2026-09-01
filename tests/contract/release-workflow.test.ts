import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const workflow = readFileSync(
  new URL("../../.github/workflows/release.yml", import.meta.url),
  "utf8",
);
const publishScript = readFileSync(
  new URL("../../scripts/publish-release.mjs", import.meta.url),
  "utf8",
);

describe("automatic release workflow", () => {
  it("runs only for main pushes or main manual retries", () => {
    expect(workflow).toMatch(/push:\s*\n\s*branches:\s*\[main\]/);
    expect(workflow).toContain("workflow_dispatch:");
    expect(workflow).toContain("github.ref == 'refs/heads/main'");
    expect(workflow).not.toContain("pull_request:");
  });

  it("pins the Arm64 build environment and IINA package", () => {
    expect(workflow).toContain("runs-on: macos-15");
    expect(workflow).toContain('test "$(uname -m)" = "arm64"');
    expect(workflow).toContain('node-version: "24.18.0"');
    expect(workflow).toContain("IINA.v1.4.4.dmg");
    expect(workflow).toContain("dd0fc0bd4b37fb57a1c8d30d6e3201b3a64bafd29959fe56953964613237beb1");
  });

  it("pins every official action to a full commit SHA", () => {
    expect(workflow).toContain("actions/checkout@de0fac2e4500dabe0009e67214ff5f5447ce83dd");
    expect(workflow).toContain("actions/setup-node@820762786026740c76f36085b0efc47a31fe5020");
    expect(workflow).toContain("actions/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a");
    expect(workflow).toContain(
      "actions/download-artifact@3e5f45b2cfb9172054b4087a40e8e0b5a5461e7c",
    );
    expect(workflow.match(/uses:\s+[^\s]+@[^\s]+/g) ?? []).toSatisfy((uses: string[]) =>
      uses.every((value) => /@[0-9a-f]{40}$/.test(value)),
    );
  });

  it("executes all eight gates in the required order", () => {
    const gates = [
      "run: npm run test\n",
      "run: npm run typecheck\n",
      "run: npm run lint\n",
      "run: npm run build:native\n",
      "run: npm run test:native\n",
      "run: npm run build\n",
      "run: npm run verify:package\n",
      "run: npm run pack\n",
    ];
    const positions = gates.map((gate) => workflow.indexOf(gate));

    expect(positions.every((position) => position >= 0)).toBe(true);
    expect(positions).toEqual([...positions].sort((left, right) => left - right));
  });

  it("separates read-only build from write-enabled publication", () => {
    expect(workflow).toMatch(/build:\s*\n[\s\S]*?permissions:\s*\n\s*contents: read/);
    expect(workflow).toMatch(
      /publish:\s*\n[\s\S]*?needs: build[\s\S]*?permissions:\s*\n\s*contents: write/,
    );
    expect(workflow).toContain("node scripts/publish-release.mjs");
    expect(workflow).not.toContain("PAT");
    expect(workflow).not.toMatch(/--clobber|uses:.*release-action/i);
  });

  it("serializes release attempts without cancelling an upload", () => {
    expect(workflow).toMatch(/group:.*github\.ref/);
    expect(workflow).toContain("cancel-in-progress: false");
  });

  it("does not retain a published release replacement path", () => {
    expect(workflow).not.toContain("--replace-old-commit");
    expect(workflow).not.toContain("--replace-old-artifact-sha256");
  });

  it("audits both native executables and publishes the locked FFmpeg source only from the audited payload", () => {
    expect(workflow).toContain("--build-helper dist/native/subtandem-transport");
    expect(workflow).toContain("--build-extractor dist/native/subtandem-subtitle-extractor");
    expect(workflow).toContain("--build-style-picker dist/native/subtandem-style-picker");
    expect(workflow).toContain(
      "--ffmpeg-source native/.build/ffmpeg/downloads/ffmpeg-8.1.2.tar.xz",
    );
    expect(workflow).toContain("--ffmpeg-lock native/ffmpeg.lock.json");
    expect(workflow).toContain("path: build/release/");
    expect(workflow).not.toContain("native/.build/ffmpeg/downloads/**");
  });

  it("passes the versioned user body from metadata through audit to publication", () => {
    expect(workflow).toContain(
      "release_notes_path: ${{ steps.metadata.outputs.release_notes_path }}",
    );
    expect(workflow).toContain(
      "release_notes_sha256: ${{ steps.metadata.outputs.release_notes_sha256 }}",
    );
    expect(workflow).toContain(
      '--release-notes "${{ steps.metadata.outputs.release_notes_path }}"',
    );
    expect(workflow).toContain(
      '--release-notes-sha256 "${{ steps.metadata.outputs.release_notes_sha256 }}"',
    );
    expect(workflow).toContain("path: build/release/");
    expect(workflow).toContain("--notes-file build/release/release-notes.md");
    expect(workflow).toContain(
      '--expected-github-repository "${{ steps.metadata.outputs.github_repository }}"',
    );
    expect(workflow).toContain(
      '--expected-github-version "${{ steps.metadata.outputs.github_version }}"',
    );
  });

  it("does not generate, commit, or push a release body in the workflow", () => {
    expect(workflow).not.toMatch(/buildReleaseNotes|git\s+(add|commit|push)/);
    expect(workflow).not.toMatch(
      /release-notes\.md.*(echo|printf)|(?:echo|printf).*release-notes\.md/,
    );
  });

  it("validates the audited body before the first remote release lookup", () => {
    const publication = publishScript.slice(
      publishScript.indexOf("export async function publishRelease"),
    );
    expect(publication.indexOf("readAuditedReleaseNotes(")).toBeGreaterThanOrEqual(0);
    expect(publication.indexOf("readAuditedReleaseNotes(")).toBeLessThan(
      publication.indexOf("findRelease(options.repository"),
    );
  });

  it("writes technical evidence to the Actions summary without adding public assets", () => {
    expect(workflow).toContain('--summary-file "$GITHUB_STEP_SUMMARY"');
    expect(workflow).toContain("--notes-file build/release/release-notes.md");
    expect(workflow).not.toMatch(/--notes-file[^\n]*release-audit\.json/);
    expect(workflow).not.toMatch(/release\s+upload[^\n]*(release-audit|release-notes)/);
    expect(workflow).toMatch(/build:\s*\n[\s\S]*?contents: read/);
    expect(workflow).toMatch(/publish:\s*\n[\s\S]*?contents: write/);
  });
});
