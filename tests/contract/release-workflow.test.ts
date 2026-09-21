import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const workflow = readFileSync(
  new URL("../../.github/workflows/release.yml", import.meta.url),
  "utf8",
);
const pullRequestWorkflow = readFileSync(
  new URL("../../.github/workflows/ci.yml", import.meta.url),
  "utf8",
);
const publishScript = readFileSync(
  new URL("../../scripts/publish-release.mjs", import.meta.url),
  "utf8",
);

const sharedGates = [
  "run: npm run test\n",
  "run: npm run typecheck\n",
  "run: npm run lint\n",
  "run: npm run format:check\n",
  "run: npm run build:native\n",
  "run: npm run test:native\n",
  "run: npm run build\n",
  "run: npm run verify:package\n",
];

const gatePositions = (source: string, gates: string[]): number[] =>
  gates.map((gate) => source.indexOf(gate));

const actionCommit = (source: string, action: string): string | undefined =>
  source.match(new RegExp(`uses:\\s+${action}@([0-9a-f]{40})`))?.[1];

describe("automatic release workflow", () => {
  it("runs only for main pushes or main manual retries", () => {
    expect(workflow).toMatch(/push:\s*\n\s*branches:\s*\[main\]/);
    expect(workflow).toContain("workflow_dispatch:");
    expect(workflow).toContain("github.ref == 'refs/heads/main'");
    expect(workflow).not.toContain("pull_request:");
  });

  it("pins the Arm64 build environment and IINA package", () => {
    expect(workflow).toContain("runs-on: macos-15");
    expect(workflow).toContain("DEVELOPER_DIR: /Applications/Xcode_26.3.app/Contents/Developer");
    expect(workflow).toContain('test -d "$DEVELOPER_DIR"');
    expect(workflow).toContain("xcodebuild -version | grep -Fx 'Xcode 26.3'");
    expect(workflow).toContain("./scripts/verify-native-toolchain.sh");
    expect(workflow).not.toContain("swiftbuild-probe");
    expect(workflow).not.toContain("swift build -help");
    expect(workflow).toContain('test "$(uname -m)" = "arm64"');
    expect(workflow).toContain('node-version: "24.18.0"');
    expect(workflow).toContain("IINA.v1.4.4.dmg");
    expect(workflow).toContain("dd0fc0bd4b37fb57a1c8d30d6e3201b3a64bafd29959fe56953964613237beb1");
  });

  it("pins every official action to a full commit SHA", () => {
    for (const action of [
      "actions/checkout",
      "actions/setup-node",
      "actions/upload-artifact",
      "actions/download-artifact",
    ]) {
      expect(actionCommit(workflow, action)).toMatch(/^[0-9a-f]{40}$/);
    }
    expect(workflow.match(/uses:\s+[^\s]+@[^\s]+/g) ?? []).toSatisfy((uses: string[]) =>
      uses.every((value) => /@[0-9a-f]{40}$/.test(value)),
    );
  });

  it("executes all nine gates in the required order", () => {
    const positions = gatePositions(workflow, [...sharedGates, "run: npm run pack\n"]);

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

describe("pull request CI workflow", () => {
  it("runs only for pull requests targeting main", () => {
    expect(pullRequestWorkflow).toMatch(/pull_request:\s*\n\s*branches:\s*\[main\]/);
    expect(pullRequestWorkflow).not.toMatch(/^\s*push:/m);
    expect(pullRequestWorkflow).not.toContain("workflow_dispatch:");
    expect(pullRequestWorkflow).not.toContain("pull_request_target:");
  });

  it("uses a read-only token without secrets or publication steps", () => {
    expect(pullRequestWorkflow).toMatch(/permissions:\s*\n\s*contents: read/);
    expect(pullRequestWorkflow).not.toContain("contents: write");
    expect(pullRequestWorkflow).not.toContain("secrets.");
    expect(pullRequestWorkflow).not.toContain("npm run pack");
    expect(pullRequestWorkflow).not.toContain("IINA.v1.4.4.dmg");
    expect(pullRequestWorkflow).not.toMatch(/upload-artifact|publish-release|release-metadata/);
  });

  it("pins the release build environment and every action", () => {
    expect(pullRequestWorkflow).toContain("runs-on: macos-15");
    expect(pullRequestWorkflow).toContain(
      "DEVELOPER_DIR: /Applications/Xcode_26.3.app/Contents/Developer",
    );
    expect(pullRequestWorkflow).toContain("xcodebuild -version | grep -Fx 'Xcode 26.3'");
    expect(pullRequestWorkflow).toContain("./scripts/verify-native-toolchain.sh");
    expect(pullRequestWorkflow).not.toContain("swiftbuild-probe");
    expect(pullRequestWorkflow).toContain('node-version: "24.18.0"');
    expect(actionCommit(pullRequestWorkflow, "actions/checkout")).toBe(
      actionCommit(workflow, "actions/checkout"),
    );
    expect(actionCommit(pullRequestWorkflow, "actions/setup-node")).toBe(
      actionCommit(workflow, "actions/setup-node"),
    );
    expect(pullRequestWorkflow).toContain("persist-credentials: false");
    expect(actionCommit(pullRequestWorkflow, "actions/cache")).toBe(
      "55cc8345863c7cc4c66a329aec7e433d2d1c52a9",
    );
    expect(pullRequestWorkflow.match(/uses:\s+[^\s]+@[^\s]+/g) ?? []).toSatisfy((uses: string[]) =>
      uses.every((value) => /@[0-9a-f]{40}$/.test(value)),
    );
  });

  it("caches validated FFmpeg outputs and incremental Swift state only for pull requests", () => {
    expect(pullRequestWorkflow).toContain("native/.build/ffmpeg/downloads/ffmpeg-8.1.2.tar.xz");
    expect(pullRequestWorkflow).toContain("native/.build/ffmpeg/build-context.sha256");
    expect(pullRequestWorkflow).toContain("native/.build/module-cache");
    expect(pullRequestWorkflow).toContain("native/.build/swiftbuild");
    expect(pullRequestWorkflow).toContain("native-ffmpeg-${{ runner.os }}-${{ runner.arch }}");
    expect(pullRequestWorkflow).toContain("xcode-26.3-macos12");
    expect(pullRequestWorkflow).toContain("native-swift-${{ runner.os }}-${{ runner.arch }}");
    expect(pullRequestWorkflow).toContain("restore-keys:");
    expect(workflow).not.toContain("actions/cache@");
  });

  it("cancels superseded runs for the same pull request", () => {
    expect(pullRequestWorkflow).toContain("github.event.pull_request.number");
    expect(pullRequestWorkflow).toContain("cancel-in-progress: true");
  });

  it("keeps all shared release gates in the same order", () => {
    expect(pullRequestWorkflow).toContain("run: npm ci");
    const pullRequestPositions = gatePositions(pullRequestWorkflow, sharedGates);
    const releasePositions = gatePositions(workflow, sharedGates);

    expect(pullRequestPositions.every((position) => position >= 0)).toBe(true);
    expect(pullRequestPositions).toEqual(
      [...pullRequestPositions].sort((left, right) => left - right),
    );
    expect(releasePositions.every((position) => position >= 0)).toBe(true);
    expect(releasePositions).toEqual([...releasePositions].sort((left, right) => left - right));
  });
});
