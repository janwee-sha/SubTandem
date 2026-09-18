import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import {
  discoverHelperExecutable,
  parseReadyFrame,
  removeStaleHelperFiles,
  TransportProcess,
  type ReadyFileStore,
} from "../../src/adapters/iina/transport-process.js";
import {
  HelperProviderTransport,
  IinaFileRpcBridge,
  IinaProcessLauncher,
} from "../../src/adapters/iina/provider-transport.js";
import { SubtitleExtractorProcess } from "../../src/adapters/iina/subtitle-extractor.js";
import {
  TRANSPORT_RPC_ERROR_CODES,
  TransportClient,
  TransportRpcError,
  type LocalRpcBridge,
} from "../../src/transport/client.js";

class FakeBridge implements LocalRpcBridge {
  readonly calls: Array<{ port: number; path: string; token: string; body: unknown }> = [];
  unavailable = false;
  credentials = new Map<string, Record<string, string>>();

  async post<T>(port: number, token: string, path: string, body: unknown): Promise<T> {
    if (this.unavailable) throw new Error("connection refused with private body");
    this.calls.push({ port, path, token, body });
    if (path === "/v1/health") return { state: "ok" } as T;
    if (path === "/v1/credentials") {
      const request = body as {
        action?: string;
        profileId?: string;
        fields?: Record<string, string>;
        commitId?: string;
        expectedStoreRevision?: number;
        expectedProfileRevision?: number;
      };
      if (request.action === "write" && request.profileId && request.fields) {
        this.credentials.set(request.profileId, { ...request.fields });
        return {
          state: "committed",
          initialized: true,
          storeRevision: 2,
          lastCommit: {
            commitId: request.commitId,
            operation: "credential-write",
            baseRevision: request.expectedStoreRevision,
            requestDigest: "safe",
          },
          profileState: {
            profiles: [
              {
                profileId: request.profileId,
                revision: request.expectedProfileRevision,
                displayName: "A",
                kind: "openai",
                endpoint: "https://example.test/v1",
                endpointFingerprint: "fingerprint",
                proxyMode: "direct",
                model: "model-a",
              },
            ],
            activation: null,
          },
          credentialConfigured: { [request.profileId]: true },
        } as T;
      }
      if (request.action === "read" && request.profileId) {
        return { fields: this.credentials.get(request.profileId) ?? null } as T;
      }
    }
    if (path === "/v1/cancel") return { state: "cancelled" } as T;
    if (path === "/v1/shutdown") return { state: "shutting-down" } as T;
    return {
      jobId: "job-1",
      transportState: "completed",
      statusCode: 200,
      headers: { "x-request-id": "safe-id" },
      bodyText: "{}",
    } as T;
  }
}

class MemoryReadyFiles implements ReadyFileStore {
  readonly files = new Map<string, string>();
  readonly deleted: string[] = [];

  exists(path: string): boolean {
    return this.files.has(path);
  }

  read(path: string): string | null {
    return this.files.get(path) ?? null;
  }

  write(path: string, content: string): void {
    this.files.set(path, content);
  }

  delete(path: string): void {
    this.deleted.push(path);
    this.files.delete(path);
  }
}

function readyFrame(createdAtMs = Date.now()): string {
  return `${JSON.stringify({
    type: "ready",
    port: 49152,
    token: "abcDEF123_-",
    protocolVersion: 1,
    createdAtMs,
  })}\n`;
}

describe("transport helper client", () => {
  it("keeps transport and extractor RPC off IINA's HTTP Promise bridge", () => {
    const providerSource = readFileSync(
      new URL("../../src/adapters/iina/provider-transport.ts", import.meta.url),
      "utf8",
    );
    const extractorSource = readFileSync(
      new URL("../../src/adapters/iina/subtitle-extractor.ts", import.meta.url),
      "utf8",
    );
    const globalSource = readFileSync(new URL("../../src/global.ts", import.meta.url), "utf8");
    const mainSource = readFileSync(new URL("../../src/main.ts", import.meta.url), "utf8");

    expect(providerSource).not.toContain("IINA.API.HTTP");
    expect(providerSource).not.toContain("this.http");
    expect(extractorSource).not.toContain("IINA.API.HTTP");
    expect(globalSource).toContain("new IinaFileRpcBridge");
    expect(mainSource).toContain("new IinaFileRpcBridge");
    expect(mainSource).not.toContain("runtime.http");
  });

  it("declares non-sensitive Profile state conflict and validation errors", () => {
    expect(TRANSPORT_RPC_ERROR_CODES).toEqual(
      expect.arrayContaining(["profile-state-conflict", "invalid-profile-state"]),
    );
  });
  it("accepts only one exact framed ready object", () => {
    expect(parseReadyFrame(readyFrame(10_000), 9_000, 10_000)).toEqual({
      type: "ready",
      port: 49152,
      token: "abcDEF123_-",
      protocolVersion: 1,
      createdAtMs: 10_000,
    });
    expect(() => parseReadyFrame("debug\n{}")).toThrow();
    expect(() =>
      parseReadyFrame(
        '{"type":"ready","port":80,"token":"x","protocolVersion":2,"createdAtMs":10000}',
      ),
    ).toThrow();
  });

  it("calls long-lived helpers without JavaScript stdout or stderr hooks", async () => {
    const calls: unknown[][] = [];
    const launcher = new IinaProcessLauncher({
      exec: (...args: unknown[]) => {
        calls.push(args);
        return Promise.resolve({ status: 0, stdout: "", stderr: "" });
      },
    } as unknown as IINA.API.Utils);

    await launcher.launch("helper", ["--serve"]);

    expect(calls).toEqual([["helper", ["--serve"]]]);
  });

  it("derives the absolute installed helper path from IINA's @data directory", () => {
    const helper = discoverHelperExecutable({
      resolvePath: () =>
        "/Users/example/Library/Application Support/com.colliderli.iina/plugins/.data/io.subtandem.iina",
      exists: (path) =>
        path.endsWith("/io.subtandem.iina.iinaplugin/dist/native/subtandem-transport"),
    });
    expect(helper).toBe(
      "/Users/example/Library/Application Support/com.colliderli.iina/plugins/io.subtandem.iina.iinaplugin/dist/native/subtandem-transport",
    );
  });

  it("discovers the helper through an identifier-matched development plugin link", () => {
    const plugins = "/Users/example/Library/Application Support/com.colliderli.iina/plugins";
    const developmentRoot = `${plugins}/SubTandem.iinaplugin-dev`;
    const helper = discoverHelperExecutable({
      resolvePath: () => `${plugins}/.data/io.subtandem.iina`,
      exists: (path) => path === `${developmentRoot}/dist/native/subtandem-transport`,
      list: () => [
        // IINA can expose a CLI-created package symlink with isDir=false.
        { filename: "SubTandem.iinaplugin-dev", path: developmentRoot, isDir: false },
        {
          filename: "Unrelated.iinaplugin-dev",
          path: `${plugins}/Unrelated.iinaplugin-dev`,
          isDir: true,
        },
      ],
      read: (path) =>
        path === `${developmentRoot}/Info.json`
          ? JSON.stringify({ identifier: "io.subtandem.iina" })
          : JSON.stringify({ identifier: "example.unrelated" }),
    });

    expect(helper).toBe(`${developmentRoot}/dist/native/subtandem-transport`);
  });

  it("rejects ambiguous identifier-matched plugin roots instead of executing an arbitrary helper", () => {
    const plugins = "/Users/example/Library/Application Support/com.colliderli.iina/plugins";
    expect(() =>
      discoverHelperExecutable({
        resolvePath: () => `${plugins}/.data/io.subtandem.iina`,
        exists: (path) => !path.includes("/io.subtandem.iina.iinaplugin/"),
        list: () => [
          {
            filename: "SubTandem-A.iinaplugin-dev",
            path: `${plugins}/SubTandem-A.iinaplugin-dev`,
            isDir: true,
          },
          {
            filename: "SubTandem-B.iinaplugin-dev",
            path: `${plugins}/SubTandem-B.iinaplugin-dev`,
            isDir: true,
          },
        ],
        read: () => JSON.stringify({ identifier: "io.subtandem.iina" }),
      }),
    ).toThrow(/PACKAGED_HELPER_AMBIGUOUS/);
  });

  it("uses the ready frame and fails promptly when the helper exits during startup", async () => {
    const readyFiles = new MemoryReadyFiles();
    await expect(
      TransportProcess.bootstrap(
        {
          launch: async (_executable, args, onStdout) => {
            expect(args.slice(0, 3)).toEqual([
              "--data-directory",
              "/private/test/io.subtandem.iina",
              "--ready-file",
            ]);
            expect(onStdout).toBeUndefined();
            readyFiles.files.set(args[3]!, readyFrame());
            return new Promise<{ status: number }>(() => undefined);
          },
        },
        readyFiles,
        { dataDirectory: "/private/test/io.subtandem.iina" },
      ),
    ).resolves.toMatchObject({ port: 49152, token: "abcDEF123_-" });
    expect(readyFiles.files.size).toBe(0);
    expect(readyFiles.deleted).toHaveLength(1);

    await expect(
      TransportProcess.bootstrap(
        { launch: async () => ({ status: 127 }) },
        new MemoryReadyFiles(),
        { dataDirectory: "/private/test/io.subtandem.iina" },
      ),
    ).rejects.toMatchObject({ code: "HELPER_START_FAILED", userAction: "RESTART_IINA" });
  });

  it("keeps IINA pseudo paths separate from native helper paths", async () => {
    const readyFiles = new MemoryReadyFiles();
    let nativeReadyFile = "";
    await expect(
      TransportProcess.bootstrap(
        {
          launch: async (_executable, args) => {
            nativeReadyFile = args[3]!;
            const filename = nativeReadyFile.slice(nativeReadyFile.lastIndexOf("/") + 1);
            readyFiles.files.set(`@data/.ready/${filename}`, readyFrame());
            return new Promise<{ status: number }>(() => undefined);
          },
        },
        readyFiles,
        {
          dataDirectory: "/private/plugin-data",
          fileDirectory: "@data",
        },
      ),
    ).resolves.toMatchObject({ port: 49152 });

    expect(nativeReadyFile).toMatch(/^\/private\/plugin-data\/\.ready\/transport-/);
    expect(readyFiles.deleted[0]).toMatch(/^@data\/\.ready\/transport-/);
  });

  it("rejects and cleans an expired or malformed ready file", async () => {
    for (const content of [readyFrame(Date.now() - 60_000), "not-json\n"]) {
      const readyFiles = new MemoryReadyFiles();
      await expect(
        TransportProcess.bootstrap(
          {
            launch: async (_executable, args) => {
              readyFiles.files.set(args[3]!, content);
              return new Promise<{ status: number }>(() => undefined);
            },
          },
          readyFiles,
          { dataDirectory: "/private/test/io.subtandem.iina" },
        ),
      ).rejects.toMatchObject({ code: "HELPER_PROTOCOL" });
      expect(readyFiles.files.size).toBe(0);
      expect(readyFiles.deleted).toHaveLength(1);
    }
  });

  it("times out without a ready file and leaves no handshake artifact", async () => {
    vi.useFakeTimers();
    try {
      const readyFiles = new MemoryReadyFiles();
      const bootstrap = TransportProcess.bootstrap(
        { launch: async () => new Promise<{ status: number }>(() => undefined) },
        readyFiles,
        { dataDirectory: "/private/test/io.subtandem.iina" },
      );
      const rejected = expect(bootstrap).rejects.toMatchObject({ code: "HELPER_START_TIMEOUT" });
      await vi.advanceTimersByTimeAsync(5_100);
      await rejected;
      expect(readyFiles.files.size).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("removes only bounded, stale helper handshake and RPC files", () => {
    const now = Date.now();
    const old = (now - 600_000).toString(36);
    const recent = (now - 10_000).toString(36);
    const files = new Map<string, string>([
      [`/private/plugin/.ready/transport-${old}-1-old.json`, "old"],
      [`/private/plugin/.ready/transport-${recent}-2-new.json`, "new"],
      [`/private/plugin/.rpc/extractor-${old}-3-old.request.json`, "private"],
      [`/private/plugin/.rpc/unrelated-${old}-4-old.response.json`, "keep"],
    ]);
    const deleted: string[] = [];
    removeStaleHelperFiles(
      {
        exists: (path) => files.has(path),
        read: (path) => files.get(path) ?? null,
        delete: (path) => {
          deleted.push(path);
          files.delete(path);
        },
        list: (directory) =>
          [...files.keys()]
            .filter((path) => path.startsWith(`${directory}/`))
            .map((path) => ({ filename: path.slice(directory.length + 1), isDir: false })),
      },
      "/private/plugin",
      now,
    );

    expect(deleted).toEqual([
      `/private/plugin/.ready/transport-${old}-1-old.json`,
      `/private/plugin/.rpc/extractor-${old}-3-old.request.json`,
    ]);
    expect(files.has(`/private/plugin/.ready/transport-${recent}-2-new.json`)).toBe(true);
    expect(files.has(`/private/plugin/.rpc/unrelated-${old}-4-old.response.json`)).toBe(true);
  });

  it("starts transport and extractor together with parent liveness arguments", async () => {
    const readyFiles = new MemoryReadyFiles();
    const launches: Array<{ executable: string; args: string[]; hooked: boolean }> = [];
    const launcher = {
      launch: async (executable: string, args: string[], onStdout?: (data: string) => void) => {
        launches.push({ executable, args, hooked: onStdout !== undefined });
        const readyPath = args[3]!;
        readyFiles.files.set(readyPath, readyFrame());
        return new Promise<{ status: number }>(() => undefined);
      },
    };

    await expect(
      Promise.all([
        TransportProcess.bootstrap(launcher, readyFiles, {
          dataDirectory: "/private/plugin-data",
          parentPid: 999_999,
        }),
        SubtitleExtractorProcess.bootstrap(
          launcher,
          readyFiles,
          { tempDirectory: "/private/plugin-tmp", parentPid: 999_999 },
          "/private/subtandem-subtitle-extractor",
        ),
      ]),
    ).resolves.toEqual([
      { port: 49152, token: "abcDEF123_-" },
      expect.objectContaining({ port: 49152, token: "abcDEF123_-" }),
    ]);
    expect(launches).toHaveLength(2);
    expect(launches.every((launch) => !launch.hooked)).toBe(true);
    expect(launches.every((launch) => launch.args.includes("999999"))).toBe(true);
    expect(JSON.stringify(launches)).not.toContain("abcDEF123_-");
    expect(readyFiles.files.size).toBe(0);
  });

  it("sends bearer-authenticated health/credential/request/cancel RPC to loopback", async () => {
    const bridge = new FakeBridge();
    const client = new TransportClient({ port: 49152, token: "session-token" }, bridge);
    await expect(client.health()).resolves.toBeUndefined();
    await expect(
      client.request({
        jobId: "job-1",
        method: "POST",
        url: "https://example.test",
        headers: {},
        body: {},
        timeoutMs: 1_000,
        maxResponseBytes: 1_024,
      }),
    ).resolves.toMatchObject({ statusCode: 200 });
    await expect(client.cancel("job-1")).resolves.toBe("cancelled");
    const profileId = "7a90a4e6-cc4f-4f59-99b7-8ff522f887ae";
    await expect(
      client.credentialWrite(
        profileId,
        { apiKey: "private-key" },
        "00000000-0000-4000-8000-000000000001",
        1,
        1,
      ),
    ).resolves.toMatchObject({ state: "committed", storeRevision: 2 });
    await expect(client.credentialRead(profileId)).resolves.toEqual({ apiKey: "private-key" });
    expect(client).not.toHaveProperty("credentialDelete");
    expect(bridge.calls.every((call) => call.token === "session-token")).toBe(true);
    expect(bridge.calls.every((call) => call.port === 49152)).toBe(true);
    expect(bridge.calls.every((call) => call.path.startsWith("/v1/"))).toBe(true);
  });

  it("maps provider request labels to helper-required UUID job IDs", async () => {
    const bridge = new FakeBridge();
    const client = new TransportClient({ port: 49152, token: "session-token" }, bridge);
    const helperJobId = "7a90a4e6-cc4f-4f59-99b7-8ff522f887ae";
    const transport = new HelperProviderTransport(client, () => helperJobId);
    await transport.request({
      jobId: "probe-version",
      method: "GET",
      url: "http://127.0.0.1:11434/api/version",
      headers: {},
      timeoutMs: 1_000,
      maxResponseBytes: 1_024,
    });
    expect(bridge.calls.at(-1)?.body).toMatchObject({ jobId: helperJobId });
  });

  it("normalizes unavailable-helper failures without leaking bridge messages", async () => {
    const bridge = new FakeBridge();
    bridge.unavailable = true;
    const client = new TransportClient({ port: 49152, token: "secret-token" }, bridge);
    await expect(client.cancel("job-1")).rejects.toMatchObject({ code: "HELPER_UNAVAILABLE" });
    await expect(client.cancel("job-1")).rejects.not.toThrow(/private body|secret-token/);
  });

  it("maps a failed native RPC client to an unavailable helper without leaking request data", async () => {
    const files = new MemoryReadyFiles();
    const bridge = new IinaFileRpcBridge(
      { launch: async () => ({ status: 1 }) },
      files,
      "/private/subtandem-transport",
      {
        helper: "transport",
        fileDirectory: "@data/.rpc",
        nativeDirectory: "/private/plugin-data/.rpc",
        maxRequestBytes: 2_101_248,
        maxResponseBytes: 4_210_688,
        maxConcurrentRequests: 8,
      },
    );
    const client = new TransportClient({ port: 49152, token: "secret-token" }, bridge);

    await expect(client.health()).rejects.toMatchObject({
      code: "HELPER_UNAVAILABLE",
      retryable: true,
      userAction: "RESTART_IINA",
    });
    await expect(client.health()).rejects.not.toThrow(/secret-token/);
    expect(files.files.size).toBe(0);
  });

  it("preserves safe upstream timeout and network classifications from the helper", async () => {
    for (const [rpcCode, expected] of [
      [
        "upstream-timeout",
        { code: "PROVIDER_TIMEOUT", category: "timeout", userAction: "CHECK_NETWORK" },
      ],
      [
        "upstream-network",
        { code: "PROVIDER_NETWORK", category: "network", userAction: "CHECK_NETWORK" },
      ],
      [
        "forbidden-destination",
        { code: "FORBIDDEN_DESTINATION", category: "configuration", userAction: "CHECK_ENDPOINT" },
      ],
    ] as const) {
      const bridge: LocalRpcBridge = {
        post: async () => {
          throw new TransportRpcError(rpcCode);
        },
      };
      const client = new TransportClient({ port: 49152, token: "session-token" }, bridge);
      await expect(
        client.request({
          jobId: "job-1",
          method: "POST",
          url: "https://example.test",
          headers: {},
          timeoutMs: 1_000,
          maxResponseBytes: 1_024,
        }),
      ).rejects.toMatchObject(expected);
    }
  });

  it("publishes a private request, waits for native completion, parses the response, and cleans both files", async () => {
    const files = new MemoryReadyFiles();
    const launches: Array<{ executable: string; args: string[] }> = [];
    const bridge = new IinaFileRpcBridge(
      {
        launch: async (executable, args) => {
          launches.push({ executable, args });
          const requestEntry = [...files.files].find(([path]) => path.endsWith(".request.json"));
          expect(requestEntry).toBeDefined();
          expect(JSON.parse(requestEntry![1])).toMatchObject({
            type: "request",
            protocolVersion: 1,
            port: 49152,
            token: "secret-token",
            path: "/v1/health",
            body: {},
          });
          const responsePath = requestEntry![0].replace(".request.json", ".response.json");
          files.write(
            responsePath,
            JSON.stringify({
              type: "response",
              protocolVersion: 1,
              createdAtMs: Date.now(),
              statusCode: 200,
              body: { state: "ok" },
            }),
          );
          return { status: 0 };
        },
      },
      files,
      "/private/subtandem-transport",
      {
        helper: "transport",
        fileDirectory: "@data/.rpc",
        nativeDirectory: "/private/plugin-data/.rpc",
        maxRequestBytes: 2_097_152,
        maxResponseBytes: 4_210_688,
        maxConcurrentRequests: 8,
      },
    );

    await expect(bridge.post(49152, "secret-token", "/v1/health", {})).resolves.toEqual({
      state: "ok",
    });
    expect(launches).toHaveLength(1);
    expect(launches[0]?.args).toEqual([
      "--rpc-client",
      "--rpc-directory",
      "/private/plugin-data/.rpc",
      "--request-file",
      expect.stringMatching(/^\/private\/plugin-data\/\.rpc\/transport-/),
      "--response-file",
      expect.stringMatching(/^\/private\/plugin-data\/\.rpc\/transport-/),
    ]);
    expect(JSON.stringify(launches)).not.toContain("secret-token");
    expect(files.files.size).toBe(0);
  });

  it("maps only an allowlisted error code from the native response file", async () => {
    const files = new MemoryReadyFiles();
    const bridge = new IinaFileRpcBridge(
      {
        launch: async () => {
          const requestPath = [...files.files.keys()].find((path) =>
            path.endsWith(".request.json"),
          )!;
          files.write(
            requestPath.replace(".request.json", ".response.json"),
            JSON.stringify({
              type: "response",
              protocolVersion: 1,
              createdAtMs: Date.now(),
              statusCode: 504,
              body: { error: "upstream-timeout", detail: "private provider response" },
            }),
          );
          return { status: 0 };
        },
      },
      files,
      "/private/subtandem-transport",
      {
        helper: "transport",
        fileDirectory: "@data/.rpc",
        nativeDirectory: "/private/plugin-data/.rpc",
        maxRequestBytes: 2_101_248,
        maxResponseBytes: 4_210_688,
        maxConcurrentRequests: 8,
      },
    );
    const client = new TransportClient({ port: 49152, token: "secret-token" }, bridge);

    await expect(
      client.request({
        jobId: "job-1",
        method: "POST",
        url: "https://example.test",
        headers: {},
        timeoutMs: 1_000,
        maxResponseBytes: 1_024,
      }),
    ).rejects.toMatchObject({
      code: "PROVIDER_TIMEOUT",
      category: "timeout",
      userAction: "CHECK_NETWORK",
    });
    await expect(client.health()).rejects.not.toThrow(/private provider response|secret-token/);
    expect(files.files.size).toBe(0);
  });
});
