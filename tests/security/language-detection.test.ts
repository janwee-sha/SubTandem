import { spawn, spawnSync } from "node:child_process";
import { afterEach, describe, expect, it, vi } from "vitest";
import { loadFrozenCorpora } from "../helpers/language-corpus.js";
import { createMainLanguagePlayer } from "../helpers/main-language-player.js";
import { selectNearbyCues } from "../../src/app/scheduler.js";

const body = loadFrozenCorpora().calibration.samples.find(
  (sample) => sample.sampleId === "calibration-de-eleven",
)!;
const script = "scripts/language-detection-validation.mjs";
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("language detection privacy", () => {
  it("keeps Main detection offline, limits selected-profile requests and preserves Log Viewer body debugging", async () => {
    vi.useFakeTimers();
    const fetch = vi.fn(() => {
      throw new Error("Unexpected detection network access");
    });
    vi.stubGlobal("fetch", fetch);
    const player = await createMainLanguagePlayer(body, { tag: "private-wrong-tag" });
    await player.advance();
    expect(fetch).not.toHaveBeenCalled();
    expect(player.runtime.http.request).not.toHaveBeenCalled();
    const nearby = new Set(selectNearbyCues(body.cues, body.cues[0]!.startMs).map((cue) => cue.id));
    expect(player.requests.length).toBeGreaterThan(0);
    expect(
      player.requests.every(
        (request) =>
          request.profileId === "chosen-profile" &&
          request.profileRevision === 7 &&
          request.items.every((item) => nearby.has(item.id)),
      ),
    ).toBe(true);
    expect(
      player.logs.some(
        (line) =>
          line.includes("Source cue:") &&
          line.includes(body.cues[0]!.normalizedText) &&
          line.includes("Validation translation"),
      ),
    ).toBe(true);
    const diagnostics = player.logs.filter((line) => !line.includes("Source cue:"));
    const messages = player.runtime.global.messages.filter(
      (message) => message.name !== "provider:attempt",
    );
    const safe = JSON.stringify([diagnostics, messages, player.runtime.sidebar.messages]);
    expect(safe).not.toContain(body.cues[0]!.normalizedText);
    expect(safe).not.toMatch(
      /private-wrong-tag|media-secret|secret\.srt|confidence|candidates|authorization|apiKey/,
    );
    expect(player.metrics()).toHaveLength(1);
    expect(Object.keys(player.metrics()[0]).sort()).toEqual([
      "elapsedMs",
      "kind",
      "state",
      "stepDurationsMs",
    ]);
    const retainedLogs = [...player.logs];
    player.close();
    expect(player.controller.cacheSize).toBe(0);
    expect(player.logs).toEqual(retainedLogs);
    const next = await createMainLanguagePlayer(body);
    await next.advance();
    expect(next.requests.length).toBeGreaterThan(0);
    expect(next.metrics()[0].kind).toBe("first");
    next.close();
  });
  it("reads only safe host metrics without echoing body, credentials or unknown fields", () => {
    const metric = (kind: string) =>
      `[SubTandem language detection] ${JSON.stringify({ kind, elapsedMs: kind === "first" ? 80 : 30, stepDurationsMs: [2, 4, 8], state: "reliable" })}`;
    const input = [
      "Source cue: private-secret",
      "apiKey=private-secret",
      ...Array.from({ length: 40 }, () => metric("first")),
      ...Array.from({ length: 40 }, () => metric("repeat")),
      metric("first").replace('"elapsedMs":80', '"elapsedMs":80,"text":"private-secret"'),
    ].join("\n");
    const result = spawnSync(process.execPath, [script, "host-metrics"], {
      input,
      encoding: "utf8",
    });
    expect(result.status).toBe(0);
    expect(result.stdout + result.stderr).not.toContain("private-secret");
    expect(JSON.parse(result.stdout)).toMatchObject({
      complete: true,
      passed: true,
      firstCount: 40,
      repeatCount: 40,
    });
    const insufficient = spawnSync(process.execPath, [script, "host-metrics"], {
      input: metric("first"),
      encoding: "utf8",
    });
    expect(insufficient.status).not.toBe(0);
    expect(JSON.parse(insufficient.stdout)).toMatchObject({ complete: false, passed: false });
  });
  it("serves only loopback, preserves wire IDs and separates probes from translation without logging bodies", async () => {
    const child = spawn(process.execPath, [script, "serve", "--port", "0"], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    child.stderr.on("data", (chunk) => {
      output += String(chunk);
    });
    try {
      const address = await new Promise<{ host: string; port: number }>((resolve, reject) => {
        let frame = "";
        const timeout = setTimeout(
          () => reject(new Error("Validation server did not start")),
          5000,
        );
        child.once("error", reject);
        child.once("exit", () => {
          clearTimeout(timeout);
          reject(new Error("Validation server exited"));
        });
        child.stdout.on("data", (chunk) => {
          output += String(chunk);
          frame += String(chunk);
          if (frame.includes("\n")) {
            clearTimeout(timeout);
            resolve(JSON.parse(frame.split("\n")[0]!));
          }
        });
      });
      expect(address.host).toBe("127.0.0.1");
      const base = `http://${address.host}:${address.port}`;
      expect(await (await fetch(`${base}/v1/models`)).json()).toMatchObject({
        data: [{ id: "validation-model" }],
      });
      for (const ids of [["probe"], ["c1", "c2"]]) {
        const response = await fetch(`${base}/v1/chat/completions`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            model: "validation-model",
            messages: [
              {
                role: "user",
                content: JSON.stringify({
                  targets: ids.map((id) => ({ id, text: "private-secret" })),
                }),
              },
            ],
          }),
        });
        const result = (await response.json()) as { choices: [{ message: { content: string } }] };
        expect(
          JSON.parse(result.choices[0].message.content).translations.map(
            (item: { id: string }) => item.id,
          ),
        ).toEqual(ids);
        expect(JSON.stringify(result)).not.toContain("private-secret");
      }
      expect(await (await fetch(`${base}/metrics`)).json()).toMatchObject({
        modelCalls: 1,
        probeCalls: 1,
        translationCalls: 1,
        translatedCues: 2,
      });
      expect(output).not.toContain("private-secret");
    } finally {
      child.kill();
    }
  });
});
