import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  SubtitleExtractorClient,
  SubtitleExtractorProcess,
} from "../../src/adapters/iina/subtitle-extractor.js";
import { detectSubtitleLanguage } from "../../src/subtitles/language-detection.js";
import { loadPreparedSubtitleSource } from "../../src/subtitles/source.js";
import type { PreparedSubtitleSource } from "../../src/subtitles/types.js";
import { corpusSha256, loadLocalLanguageRegressions } from "../helpers/language-corpus.js";

const enabled = process.env.SUBTANDEM_LOCAL_LANGUAGE_REGRESSIONS === "1";

describe.skipIf(!enabled)("local language regressions", () => {
  const regressions = loadLocalLanguageRegressions();
  const prepared = new Map<string, PreparedSubtitleSource[]>();
  let processHandle: ChildProcess | undefined;
  let client: SubtitleExtractorClient | undefined;
  let temporaryDirectory: string | undefined;

  async function cleanup(): Promise<void> {
    try {
      await client?.shutdown();
    } catch {
      // The child is still stopped below if the RPC is unavailable.
    }
    processHandle?.kill();
    prepared.clear();
    if (temporaryDirectory) rmSync(temporaryDirectory, { recursive: true, force: true });
  }

  beforeAll(async () => {
    let phase = "input";
    let regressionId = "setup";
    try {
      const mediaPaths = new Map<string, string>();
      for (const regression of regressions) {
        regressionId = regression.regressionId;
        if (mediaPaths.has(regression.inputEnvironment)) continue;
        const path = process.env[regression.inputEnvironment];
        if (!path || !isAbsolute(path) || path.includes("\0")) throw new Error();
        if (corpusSha256(readFileSync(path)) !== regression.mediaSha256) throw new Error();
        mediaPaths.set(regression.inputEnvironment, path);
      }
      phase = "helper";
      regressionId = "setup";
      temporaryDirectory = mkdtempSync(join(tmpdir(), "subtandem-language-regressions-"));
      const session = await SubtitleExtractorProcess.bootstrap(
        {
          launch(executable, args, onStdout) {
            return new Promise((resolve, reject) => {
              const child = spawn(executable, args, { stdio: ["ignore", "pipe", "ignore"] });
              processHandle = child;
              let received = 0;
              child.stdout.on("data", (chunk: Buffer) => {
                received += chunk.length;
                if (received > 4096) {
                  child.kill();
                  reject(new Error("helper-output-limit"));
                } else onStdout(chunk.toString("utf8"));
              });
              child.on("error", () => reject(new Error("helper-unavailable")));
              child.on("close", (status) => resolve({ status: status ?? -1 }));
            });
          },
        },
        { tempDirectory: temporaryDirectory, parentPid: process.pid },
        fileURLToPath(new URL("../../dist/native/subtandem-subtitle-extractor", import.meta.url)),
      );
      client = new SubtitleExtractorClient(session, {
        async post<T>(url: string, token: string, body: unknown): Promise<T> {
          const response = await fetch(url, {
            method: "POST",
            headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
            body: JSON.stringify(body),
            signal: AbortSignal.timeout(16_000),
          });
          if (!response.ok) throw new Error("helper-request-failed");
          return (await response.json()) as T;
        },
      });
      for (const regression of regressions) {
        phase = "extraction";
        regressionId = regression.regressionId;
        const result = await client.prepare({
          jobId: randomUUID(),
          mediaPath: mediaPaths.get(regression.inputEnvironment)!,
          stream: { ffIndex: regression.ffIndex, sourceId: null, codec: regression.codec },
          deadlineMs: 15_000,
          maxCueCount: 20_000,
          maxOutputBytes: 16_777_216,
        });
        try {
          const bytes = readFileSync(join(temporaryDirectory, result.resultId, "output.srt"));
          if (result.sha256 !== regression.extractedSha256) throw new Error();
          const correctTag =
            regression.expected.state === "reliable" ? regression.expected.languageId : "ja";
          const variants = [undefined, correctTag, "xx-wrong"].map((language) => {
            const source = loadPreparedSubtitleSource(
              {
                trackId: regression.ffIndex,
                origin: "embedded",
                codec: regression.codec,
                ffIndex: regression.ffIndex,
                ...(language === undefined ? {} : { language }),
              },
              bytes,
              result,
            );
            if (!source || source.cues.length !== regression.cueCount) throw new Error();
            const letters =
              source.cues
                .map((cue) => cue.normalizedText)
                .join("\n")
                .match(/\p{L}/gu)?.length ?? 0;
            if (letters !== regression.letterCount) throw new Error();
            return source;
          });
          prepared.set(regressionId, variants);
        } finally {
          await client.release(result.resultId);
        }
      }
    } catch {
      await cleanup();
      throw new Error(`local-language-regression:${regressionId}:${phase}`);
    }
  }, 150_000);

  afterAll(cleanup, 20_000);

  for (const regression of regressions) {
    it(`loads original input: ${regression.regressionId}`, () => {
      expect(prepared.get(regression.regressionId)?.length).toBe(3);
    });

    it(`detects original input with invariant tags: ${regression.regressionId}`, () => {
      const variants = prepared.get(regression.regressionId)!;
      const results = variants.map((source) => detectSubtitleLanguage(source.cues));
      console.info(
        "local-language-regression",
        JSON.stringify({
          regressionId: regression.regressionId,
          result: results[0],
          labelDifferences: results.filter(
            (result) => JSON.stringify(result) !== JSON.stringify(results[0]),
          ).length,
        }),
      );
      expect(results.every((result) => JSON.stringify(result) === JSON.stringify(results[0]))).toBe(
        true,
      );
      expect(
        results.every((result) =>
          regression.expected.state === "unknown"
            ? result.state === "unknown"
            : result.state === "reliable" && result.languageId === regression.expected.languageId,
        ),
      ).toBe(true);
    });
  }
});
