import { describe, expect, it } from "vitest";
import {
  discoverHelperExecutable,
  parseReadyFrame,
  TransportProcess,
} from "../../src/adapters/iina/transport-process.js";
import {
  HelperProviderTransport,
  IinaLocalHttpBridge,
} from "../../src/adapters/iina/provider-transport.js";
import {
  TransportClient,
  TransportRpcError,
  type LocalHttpBridge,
} from "../../src/transport/client.js";

class FakeBridge implements LocalHttpBridge {
  readonly calls: Array<{ url: string; token: string; body: unknown }> = [];
  unavailable = false;
  credentials = new Map<string, Record<string, string>>();

  async post<T>(url: string, token: string, body: unknown): Promise<T> {
    if (this.unavailable) throw new Error("connection refused with private body");
    this.calls.push({ url, token, body });
    const path = new URL(url).pathname;
    if (path === "/v1/health") return { state: "ok" } as T;
    if (path === "/v1/credentials") {
      const request = body as {
        action?: string;
        profileId?: string;
        fields?: Record<string, string>;
      };
      if (request.action === "write" && request.profileId && request.fields) {
        this.credentials.set(request.profileId, { ...request.fields });
        return { state: "saved" } as T;
      }
      if (request.action === "read" && request.profileId) {
        return { fields: this.credentials.get(request.profileId) ?? null } as T;
      }
      if (request.action === "delete" && request.profileId) {
        this.credentials.delete(request.profileId);
        return { state: "deleted" } as T;
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

describe("transport helper client", () => {
  it("accepts only one exact framed ready object", () => {
    expect(
      parseReadyFrame('{"type":"ready","port":49152,"token":"abcDEF123_-","protocolVersion":1}\n'),
    ).toEqual({
      type: "ready",
      port: 49152,
      token: "abcDEF123_-",
      protocolVersion: 1,
    });
    expect(() => parseReadyFrame("debug\n{}")).toThrow();
    expect(() =>
      parseReadyFrame('{"type":"ready","port":80,"token":"x","protocolVersion":2}'),
    ).toThrow();
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
    await expect(
      TransportProcess.bootstrap(
        {
          launch: async (_executable, args, onStdout) => {
            expect(args).toEqual(["--data-directory", "/private/test/io.subtandem.iina"]);
            onStdout('{"type":"ready","port":49152,"token":"abcDEF123_-","protocolVersion":1}\n');
            return new Promise<{ status: number }>(() => undefined);
          },
        },
        { dataDirectory: "/private/test/io.subtandem.iina" },
      ),
    ).resolves.toMatchObject({ port: 49152, token: "abcDEF123_-" });

    await expect(
      TransportProcess.bootstrap(
        { launch: async () => ({ status: 127 }) },
        { dataDirectory: "/private/test/io.subtandem.iina" },
      ),
    ).rejects.toMatchObject({ code: "HELPER_START_FAILED", userAction: "RESTART_IINA" });
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
      client.credentialWrite(profileId, { apiKey: "private-key" }),
    ).resolves.toBeUndefined();
    await expect(client.credentialRead(profileId)).resolves.toEqual({ apiKey: "private-key" });
    await expect(client.credentialDelete(profileId)).resolves.toBeUndefined();
    await expect(client.credentialRead(profileId)).resolves.toBeNull();
    expect(bridge.calls.every((call) => call.token === "session-token")).toBe(true);
    expect(bridge.calls.every((call) => call.url.startsWith("http://127.0.0.1:49152/"))).toBe(true);
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

  it("maps IINA's bodyless loopback rejection to an expired helper session", async () => {
    const bridge = new IinaLocalHttpBridge({
      post: async () => Promise.reject(new Error("connection refused with private detail")),
    } as unknown as IINA.API.HTTP);
    const client = new TransportClient({ port: 49152, token: "secret-token" }, bridge);

    await expect(client.health()).rejects.toMatchObject({
      code: "HELPER_UNAVAILABLE",
      retryable: true,
      userAction: "RESTART_IINA",
    });
    await expect(client.health()).rejects.not.toThrow(/private detail|secret-token/);
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
      const bridge: LocalHttpBridge = {
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

  it("extracts only the helper's allowlisted RPC error code", async () => {
    const bridge = new IinaLocalHttpBridge({
      post: async () => ({
        statusCode: 504,
        data: { error: "upstream-timeout", detail: "private provider response" },
        text: '{"error":"upstream-timeout","detail":"private provider response"}',
      }),
    } as unknown as IINA.API.HTTP);
    await expect(
      bridge.post("http://127.0.0.1:49152/v1/request", "token", {}),
    ).rejects.toMatchObject({ code: "upstream-timeout" });
    await expect(bridge.post("http://127.0.0.1:49152/v1/request", "token", {})).rejects.not.toThrow(
      /private provider response|token/,
    );
  });

  it("extracts safe helper codes from IINA's rejected non-2xx Promise", async () => {
    const bridge = new IinaLocalHttpBridge({
      post: async () =>
        Promise.reject({
          statusCode: 504,
          data: { error: "upstream-timeout", detail: "private provider response" },
          text: '{"error":"upstream-timeout","detail":"private provider response"}',
        }),
    } as unknown as IINA.API.HTTP);
    await expect(
      bridge.post("http://127.0.0.1:49152/v1/request", "token", {}),
    ).rejects.toMatchObject({ code: "upstream-timeout" });
    await expect(bridge.post("http://127.0.0.1:49152/v1/request", "token", {})).rejects.not.toThrow(
      /private provider response|token/,
    );
  });
});
