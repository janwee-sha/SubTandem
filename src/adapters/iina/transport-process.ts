import type { TransportSession } from "../../transport/client.js";
import { SubTandemError } from "../../domain/errors.js";
import { hostTimers } from "./host-timers.js";

export interface ReadyFrame {
  type: "ready";
  port: number;
  token: string;
  protocolVersion: 1;
  createdAtMs: number;
}

export function parseReadyFrame(output: string, notBeforeMs = 0, nowMs = Date.now()): ReadyFrame {
  if (output.length > 2_048) throw new Error("Unexpected helper output");
  if (output.split("\n").filter(Boolean).length !== 1) throw new Error("Unexpected helper output");
  let value: unknown;
  try {
    value = JSON.parse(output.trim());
  } catch {
    throw new Error("Malformed helper frame");
  }
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Malformed helper frame");
  const frame = value as Record<string, unknown>;
  if (
    Object.keys(frame).sort().join(",") !== "createdAtMs,port,protocolVersion,token,type" ||
    frame.type !== "ready" ||
    frame.protocolVersion !== 1 ||
    !Number.isInteger(frame.port) ||
    (frame.port as number) < 1024 ||
    (frame.port as number) > 65535 ||
    typeof frame.token !== "string" ||
    !/^[A-Za-z0-9_-]{8,512}$/.test(frame.token) ||
    !Number.isInteger(frame.createdAtMs) ||
    (frame.createdAtMs as number) < notBeforeMs - 1_000 ||
    (frame.createdAtMs as number) > nowMs + 1_000
  ) {
    throw new Error("Invalid helper ready frame");
  }
  return frame as unknown as ReadyFrame;
}

export interface ProcessLauncher {
  launch(executable: string, args: string[]): Promise<{ status: number }>;
}

export interface ReadyFileStore {
  exists(path: string): boolean;
  read(path: string): string | null;
  delete(path: string): void;
  list?(path: string): Array<{ filename: string; isDir: boolean }>;
}

let readyFileSequence = 0;

export function createReadyFilePath(
  root: string,
  helper: "transport" | "extractor" | "style-picker",
): string {
  const nonce = [
    Date.now().toString(36),
    (++readyFileSequence).toString(36),
    Math.random().toString(36).slice(2, 14),
  ].join("-");
  return `${root.replace(/\/+$/, "")}/.ready/${helper}-${nonce}.json`;
}

function removeReadyFile(store: ReadyFileStore, path: string): void {
  try {
    if (store.exists(path)) store.delete(path);
  } catch {
    return;
  }
}

export function removeStaleHelperFiles(
  store: ReadyFileStore,
  root: string,
  nowMs = Date.now(),
): void {
  if (!store.list) return;
  const normalizedRoot = root.replace(/\/+$/, "");
  for (const [directory, pattern] of [
    [".ready", /^(?:transport|extractor|style-picker)-([0-9a-z]+)-[0-9a-z]+-[0-9a-z]+\.json$/],
    [
      ".rpc",
      /^(?:transport|extractor)-([0-9a-z]+)-[0-9a-z]+-[0-9a-z]+\.(?:request\.ready|(?:request|processing|response)\.json)$/,
    ],
  ] as const) {
    let entries: Array<{ filename: string; isDir: boolean }> = [];
    try {
      entries = store.list(`${normalizedRoot}/${directory}`).slice(0, 64);
    } catch {
      continue;
    }
    for (const entry of entries) {
      const match = pattern.exec(entry.filename);
      if (entry.isDir || !match) continue;
      const createdAtMs = Number.parseInt(match[1]!, 36);
      if (!Number.isSafeInteger(createdAtMs) || createdAtMs > nowMs - 300_000) continue;
      removeReadyFile(store, `${normalizedRoot}/${directory}/${entry.filename}`);
    }
  }
}

export class TransportProcess {
  static async bootstrap(
    launcher: ProcessLauncher,
    readyFiles: ReadyFileStore,
    options: { dataDirectory: string; fileDirectory?: string },
    executable = "@plugin/dist/native/subtandem-transport",
  ): Promise<TransportSession> {
    const fileDirectory = options.fileDirectory ?? options.dataDirectory;
    removeStaleHelperFiles(readyFiles, fileDirectory);
    const readyFile = createReadyFilePath(fileDirectory, "transport");
    const nativeReadyFile = `${options.dataDirectory.replace(/\/+$/, "")}/.ready/${readyFile.slice(
      readyFile.lastIndexOf("/") + 1,
    )}`;
    if (readyFiles.exists(readyFile)) {
      removeReadyFile(readyFiles, readyFile);
      throw new SubTandemError("HELPER_PROTOCOL", "protocol", "RESTART_IINA");
    }
    const startedAtMs = Date.now();
    let exitStatus: number | null = null;
    const completion = launcher.launch(executable, [
      "launch",
      "--data-directory",
      options.dataDirectory,
      "--ready-file",
      nativeReadyFile,
    ]);
    void completion.then(
      (result) => {
        exitStatus = result.status;
      },
      () => {
        exitStatus = -1;
      },
    );
    try {
      for (let tries = 0; tries < 250; tries += 1) {
        const output = readyFiles.exists(readyFile) ? readyFiles.read(readyFile) : null;
        if (output !== null) {
          try {
            const frame = parseReadyFrame(output, startedAtMs);
            return { port: frame.port, token: frame.token };
          } catch {
            throw new SubTandemError("HELPER_PROTOCOL", "protocol", "RESTART_IINA");
          }
        }
        if (exitStatus !== null && exitStatus !== 0)
          throw new SubTandemError("HELPER_START_FAILED", "protocol", "RESTART_IINA", true);
        await hostTimers.delay(20);
      }
      void completion;
      throw new SubTandemError("HELPER_START_TIMEOUT", "timeout", "RESTART_IINA", true);
    } finally {
      removeReadyFile(readyFiles, readyFile);
    }
  }
}

export interface HelperExecutableLocator {
  exists(path: string): boolean;
  resolvePath(path: string): string;
  list?(path: string): Array<{ filename: string; path: string; isDir: boolean }>;
  read?(path: string): string | null;
}

export function discoverHelperExecutable(
  locator: HelperExecutableLocator,
  pluginId = "io.subtandem.iina",
): string {
  const absoluteDataDirectory = locator.resolvePath("@data/.").replace(/\/+$/, "");
  const pluginDataSuffix = `/.data/${pluginId}`;
  if (!absoluteDataDirectory.endsWith(pluginDataSuffix))
    throw new Error("PLUGIN_DATA_PATH_UNEXPECTED");
  const pluginsDirectory = absoluteDataDirectory.slice(0, -pluginDataSuffix.length);
  const installedExecutable = `${pluginsDirectory}/${pluginId}.iinaplugin/dist/native/subtandem-transport`;
  let installedExecutableExists = false;
  try {
    installedExecutableExists = locator.exists(installedExecutable);
  } catch {
    installedExecutableExists = false;
  }
  if (installedExecutableExists) return installedExecutable;
  const matches: string[] = [];
  if (locator.list && locator.read) {
    let entries: Array<{ filename: string; path: string; isDir: boolean }> = [];
    try {
      entries = locator.list(pluginsDirectory);
    } catch {
      entries = [];
    }
    for (const entry of entries) {
      if (!/^[^/]+\.iinaplugin(?:-dev)?$/.test(entry.filename)) continue;
      const root = `${pluginsDirectory}/${entry.filename}`;
      try {
        const metadataText = locator.read(`${root}/Info.json`);
        if (!metadataText) continue;
        const metadata = JSON.parse(metadataText) as Record<string, unknown>;
        if (metadata.identifier !== pluginId) continue;
        const helper = `${root}/dist/native/subtandem-transport`;
        if (locator.exists(helper)) matches.push(helper);
      } catch {
        continue;
      }
    }
  }
  const unique = [...new Set(matches)];
  if (unique.length === 1) return unique[0]!;
  if (unique.length > 1)
    throw new SubTandemError("PACKAGED_HELPER_AMBIGUOUS", "configuration", "CHECK_INSTALLATION");
  throw new SubTandemError("PACKAGED_HELPER_NOT_FOUND", "configuration", "CHECK_INSTALLATION");
}
