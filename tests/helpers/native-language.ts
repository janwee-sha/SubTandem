import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  SubtitleExtractorClient,
  SubtitleExtractorError,
  SubtitleExtractorProcess,
} from "../../src/adapters/iina/subtitle-extractor.js";
import { SubtitlePreparationCoordinator } from "../../src/app/subtitle-preparation.js";

export async function nativeLanguagePreparation() {
  const directory = mkdtempSync(join(tmpdir(), "subtandem-language-"));
  let child: ChildProcess | undefined;
  try {
    const session = await SubtitleExtractorProcess.bootstrap(
      {
        launch: (executable, args, stdout) =>
          new Promise((resolveExit, reject) => {
            child = spawn(executable, args, { stdio: ["ignore", "pipe", "ignore"] });
            child.stdout!.on("data", (data) => stdout(String(data)));
            child.once("error", reject);
            child.once("exit", (status) => resolveExit({ status: status ?? 1 }));
          }),
      },
      { tempDirectory: directory, parentPid: process.pid },
      resolve("dist/native/subtandem-subtitle-extractor"),
    );
    const client = new SubtitleExtractorClient(session, {
      post: async <T>(url: string, token: string, body: unknown): Promise<T> => {
        const response = await fetch(url, {
          method: "POST",
          headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        if (!response.ok) throw new SubtitleExtractorError("EXTRACTION_FAILED");
        return (await response.json()) as T;
      },
    });
    const preparation = new SubtitlePreparationCoordinator({
      playerId: "native-language",
      extractor: client,
      readResult: (resultId) => {
        try {
          return readFileSync(join(directory, resultId, "output.srt"));
        } catch {
          return null;
        }
      },
    });
    return {
      preparation,
      directory,
      close: async () => {
        await preparation.shutdown();
        child?.kill();
        rmSync(directory, { recursive: true, force: true });
      },
    };
  } catch (error) {
    child?.kill();
    rmSync(directory, { recursive: true, force: true });
    throw error;
  }
}
