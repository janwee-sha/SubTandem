import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { vi } from "vitest";
import { CredentialEditor } from "../../ui/credential-editor.js";
import type { SaveProfileInput } from "../../src/providers/profiles.js";

export const nativeLifecycleExecutable = fileURLToPath(
  new URL("../../dist/native/subtandem-transport", import.meta.url),
);

export async function nativeGlobalLifecycle(
  options: {
    beforeStart?(directory: string): void;
    beforeRPC?(path: string, body: unknown): Promise<void>;
  } = {},
) {
  if (!existsSync(nativeLifecycleExecutable)) throw new Error("NATIVE_EXECUTABLE_REQUIRED");
  const root = mkdtempSync(join(tmpdir(), "subtandem-native-global-"));
  const directory = join(root, "data");
  const ready = join(directory, ".ready", "transport-lifecycle.json");
  mkdirSync(join(directory, ".ready"), { recursive: true, mode: 0o700 });
  const rpc: Array<{ path: string; body: unknown; result: unknown }> = [];
  let child: ChildProcess | undefined;
  let client: any;
  let runtime: any;
  async function start() {
    rmSync(ready, { force: true });
    options.beforeStart?.(directory);
    child = spawn(
      nativeLifecycleExecutable,
      [
        "serve",
        "--data-directory",
        directory,
        "--ready-file",
        ready,
        "--rpc-session",
        `${Date.now().toString(36)}-1-lifecycle`,
        "--parent-pid",
        String(process.pid),
      ],
      { stdio: "ignore" },
    );
    let launchError: unknown;
    child.once("error", (error) => {
      launchError = error;
    });
    for (let n = 0; !existsSync(ready); n++) {
      if (launchError || child.exitCode !== null || n > 150)
        throw new Error("NATIVE_LIFECYCLE_START_FAILED");
      await delay(20);
    }
    const session = JSON.parse(readFileSync(ready, "utf8"));
    const { TransportClient, TransportRpcError } = await import("../../src/transport/client.js");
    client = new TransportClient(session, {
      async post<T>(
        port: number,
        token: string,
        path: string,
        body: unknown,
        requestOptions?: { timeoutMs?: number; assertActive?: () => void },
      ): Promise<T> {
        await options.beforeRPC?.(path, body);
        requestOptions?.assertActive?.();
        const response = await fetch(`http://127.0.0.1:${port}${path}`, {
          method: "POST",
          headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(requestOptions?.timeoutMs ?? 1000),
        });
        const result = await response.json();
        rpc.push({ path, body: structuredClone(body), result: structuredClone(result) });
        requestOptions?.assertActive?.();
        if (!response.ok) throw new TransportRpcError(result.error ?? result.code);
        return result as T;
      },
    });
    await client.health();
  }
  async function stop() {
    try {
      await client?.shutdown();
    } catch (error) {
      void error;
    }
    if (child && child.exitCode === null) {
      child.kill("SIGTERM");
      await Promise.race([
        new Promise<void>((resolve) => child!.once("exit", () => resolve())),
        delay(3000),
      ]);
      if (child.exitCode === null) child.kill("SIGKILL");
    }
    child = undefined;
  }
  async function loadGlobal() {
    vi.resetModules();
    const handlers = new Map<string, (data: unknown, sender?: string) => unknown>();
    const replies: Array<{ name: string; data: any; sender: unknown }> = [];
    const listeners = new Map<string, (data: unknown) => void>();
    const closed: Array<(sender: string) => void> = [];
    vi.stubGlobal("iina", {
      preferences: { get: () => undefined, set() {}, sync() {} },
      file: {},
      utils: {},
    });
    vi.doMock("../../src/adapters/iina/global-mailbox.js", () => ({
      GlobalMailbox: class {
        onMessage(name: string, callback: (data: unknown, sender?: string) => unknown) {
          handlers.set(name, callback);
        }
        onSessionClose(callback: (sender: string) => void) {
          closed.push(callback);
        }
        postMessage(sender: unknown, name: string, data: unknown) {
          replies.push({ name, data, sender });
          listeners.get(name)?.(structuredClone(data));
        }
      },
      IinaGlobalMailboxFileStore: class {},
    }));
    vi.doMock("../../src/adapters/iina/host-timers.js", () => ({
      hostTimers: { setTimeout: () => ({ cancel() {} }), setInterval: () => ({ cancel() {} }) },
    }));
    vi.doMock("../../src/transport/supervisor.js", async (original) => {
      const module = await original<any>();
      return {
        ...module,
        TransportSupervisor: class extends module.TransportSupervisor {
          constructor() {
            super(async () => client);
          }
        },
      };
    });
    await import("../../src/global.js");
    let sequence = 0;
    const sender = "native-lifecycle-window";
    const send = async (name: string, payload: unknown, requestId = `lifecycle.${++sequence}`) => {
      const handler = handlers.get(name);
      if (!handler) throw new Error(`MISSING_NATIVE_GLOBAL_HANDLER:${name}`);
      await handler({ requestId, revision: 1, payload }, sender);
      return replies.findLast((entry) => entry.data?.requestId === requestId);
    };
    const authority = async () => (await send("profile-activation:get", {}))!.data.authority;
    const profiles = async () => (await send("profiles:list", {}))!.data.profiles;
    const readCredential = async (profile: any) => {
      const editor = new CredentialEditor({
        onMessage: (name, callback) => listeners.set(name, callback),
        postMessage: (name, data) => {
          void handlers.get(name)?.(data, sender);
        },
      });
      const sourceProfile = {
        profileId: profile.profileId,
        profileRevision: profile.revision,
        endpointFingerprint: profile.endpointFingerprint,
      };
      try {
        return await editor.read(
          {
            kind: profile.kind,
            endpoint: profile.endpoint,
            model: profile.model ?? null,
            proxyMode: profile.proxyMode,
            purpose: "read-edit",
            sourceProfile,
            save: null,
          },
          {
            drawerId: `read-${++sequence}`,
            sourceProfile,
            draftRevision: 1,
            keyEditEpoch: 0,
            submitEpoch: 0,
          },
        );
      } finally {
        editor.close();
        listeners.clear();
      }
    };
    const save = async (input: SaveProfileInput, value: string) => {
      const current = (await profiles()).find(
        (profile: any) => profile.profileId === input.profileId,
      );
      const editor = new CredentialEditor({
        onMessage: (name, callback) => listeners.set(name, callback),
        postMessage: (name, data) => {
          void handlers.get(name)?.(data, sender);
        },
      });
      try {
        return await editor.save(
          value,
          { ...input, model: input.model ?? "", proxyMode: input.proxyMode ?? "direct" },
          {
            drawerId: `lifecycle-drawer-${++sequence}`,
            sourceProfile: current
              ? {
                  profileId: current.profileId,
                  profileRevision: current.revision,
                  endpointFingerprint: current.endpointFingerprint,
                }
              : null,
            draftRevision: 1,
            keyEditEpoch: 1,
            submitEpoch: 1,
          },
          `lifecycle.save.${++sequence}`,
        );
      } finally {
        editor.close();
        listeners.clear();
      }
    };
    const createProvider = async (playerId = sender) => {
      const { GlobalProviderClient } =
        await import("../../src/adapters/iina/global-provider-client.js");
      return new GlobalProviderClient({
        onMessage: (name, callback) => listeners.set(name, callback),
        postMessage: (name, data) => {
          void handlers.get(name)?.(data, playerId);
        },
      });
    };
    return {
      send,
      authority,
      profiles,
      save,
      readCredential,
      replies,
      createProvider,
      close: () => closed.forEach((callback) => callback(sender)),
    };
  }
  try {
    await start();
    runtime = await loadGlobal();
    await runtime.authority();
  } catch (error) {
    await stop();
    rmSync(root, { recursive: true, force: true });
    throw error;
  }
  return {
    directory,
    bytes: () => readFileSync(join(directory, "credentials.json")),
    get global() {
      return runtime;
    },
    rpc,
    snapshot: () => JSON.parse(readFileSync(join(directory, "credentials.json"), "utf8")),
    async restart() {
      runtime.close();
      await stop();
      await start();
      runtime = await loadGlobal();
      await runtime.authority();
    },
    async close() {
      runtime?.close();
      await stop();
      rmSync(root, { recursive: true, force: true });
      vi.unstubAllGlobals();
      vi.doUnmock("../../src/adapters/iina/global-mailbox.js");
      vi.doUnmock("../../src/adapters/iina/host-timers.js");
      vi.doUnmock("../../src/transport/supervisor.js");
    },
  };
}
