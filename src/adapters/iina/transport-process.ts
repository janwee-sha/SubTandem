import type { TransportSession } from "../../transport/client.js";
import { SubTandemError } from "../../domain/errors.js";

export interface ReadyFrame {
  type: "ready";
  port: number;
  token: string;
  protocolVersion: 1;
}

export function parseReadyFrame(output: string): ReadyFrame {
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
    Object.keys(frame).sort().join(",") !== "port,protocolVersion,token,type" ||
    frame.type !== "ready" ||
    frame.protocolVersion !== 1 ||
    !Number.isInteger(frame.port) ||
    (frame.port as number) < 1024 ||
    (frame.port as number) > 65535 ||
    typeof frame.token !== "string" ||
    !/^[A-Za-z0-9_-]{8,512}$/.test(frame.token)
  ) {
    throw new Error("Invalid helper ready frame");
  }
  return frame as unknown as ReadyFrame;
}

export interface ProcessLauncher {
  launch(
    executable: string,
    args: string[],
    onStdout: (data: string) => void,
  ): Promise<{ status: number }>;
}

export class TransportProcess {
  static async bootstrap(
    launcher: ProcessLauncher,
    options: { dataDirectory: string; parentPid?: number },
    executable = "@plugin/dist/native/subtandem-transport",
  ): Promise<TransportSession> {
    let stdout = "";
    let exitStatus: number | null = null;
    const completion = launcher.launch(
      executable,
      [
        "--data-directory",
        options.dataDirectory,
        ...(options.parentPid === undefined ? [] : ["--parent-pid", String(options.parentPid)]),
      ],
      (data) => {
        stdout += data;
      },
    );
    void completion.then(
      (result) => {
        exitStatus = result.status;
      },
      () => {
        exitStatus = -1;
      },
    );
    for (let tries = 0; tries < 250 && !stdout.includes("\n"); tries += 1) {
      if (exitStatus !== null)
        throw new SubTandemError("HELPER_START_FAILED", "protocol", "RESTART_IINA", true);
      await new Promise<void>((resolve) => setTimeout(resolve, 20));
    }
    if (!stdout.includes("\n")) {
      void completion;
      throw new SubTandemError("HELPER_START_TIMEOUT", "timeout", "RESTART_IINA", true);
    }
    let frame: ReadyFrame;
    try {
      frame = parseReadyFrame(stdout.slice(0, stdout.indexOf("\n") + 1));
    } catch {
      throw new SubTandemError("HELPER_PROTOCOL", "protocol", "RESTART_IINA");
    }
    return { port: frame.port, token: frame.token };
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
  // IINA's utils.exec rejects relative paths, and @plugin is not a supported
  // pseudo-folder. @data lives at <plugins>/.data/<pluginId>, so derive the
  // installed package root from the one absolute plugin path IINA exposes.
  const dataDirectory = locator.resolvePath("@data/.").replace(/\/+$/, "");
  const suffix = `/.data/${pluginId}`;
  if (!dataDirectory.endsWith(suffix)) throw new Error("PLUGIN_DATA_PATH_UNEXPECTED");
  const pluginsDirectory = dataDirectory.slice(0, -suffix.length);
  const candidate = `${pluginsDirectory}/${pluginId}.iinaplugin/dist/native/subtandem-transport`;
  try {
    if (locator.exists(candidate)) return candidate;
  } catch {
    /* Fall through to a sanitized startup error. */
  }
  const matches: string[] = [];
  if (locator.list && locator.read) {
    let entries: Array<{ filename: string; path: string; isDir: boolean }> = [];
    try {
      entries = locator.list(pluginsDirectory);
    } catch {
      entries = [];
    }
    for (const entry of entries) {
      // IINA reports development package symlinks as non-directories on some
      // releases, so validate candidates by package name, identifier and the
      // helper itself instead of trusting isDir.
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
        /* Ignore malformed or inaccessible unrelated plugin packages. */
      }
    }
  }
  const unique = [...new Set(matches)];
  if (unique.length === 1) return unique[0]!;
  if (unique.length > 1)
    throw new SubTandemError("PACKAGED_HELPER_AMBIGUOUS", "configuration", "CHECK_INSTALLATION");
  throw new SubTandemError("PACKAGED_HELPER_NOT_FOUND", "configuration", "CHECK_INSTALLATION");
}
