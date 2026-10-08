import { afterEach, describe, expect, it, vi } from "vitest";
import { ProviderProfiles } from "../../src/providers/profiles.js";
import { createTestProfileAuthority } from "../helpers/profile-activation-harness.js";
import { CredentialPeer } from "../helpers/credential-peer.js";
import { FakeIinaEvent } from "../helpers/fake-iina.js";
import { sidebarHarness } from "../helpers/sidebar-harness.js";

async function host() {
  vi.useFakeTimers();
  vi.resetModules();
  const profile = new ProviderProfiles(() => "00000000-0000-4000-8000-000000000001").save({
    displayName: "One",
    kind: "openai",
    endpoint: "https://synthetic.test",
    model: "synthetic-model",
    proxyMode: "direct",
  });
  const contents = new Map<string, string>();
  let generation = 0;
  let expired = false;
  let unavailable = false;
  let sequence = 0;
  const peers = new Map<number, CredentialPeer>();
  const providerCalls: Array<{
    at: number;
    generation: number;
    requestId: string;
    deadline: number;
  }> = [];
  const rpcCalls: Array<{ at: number; generation: number; path: string; action?: string }> = [];
  const files = {
    list: (path: string) =>
      [...contents.keys()]
        .filter((p) => p.startsWith(path))
        .map((p) => ({ filename: p.slice(path.length), isDir: false })),
    exists: (path: string) =>
      path.endsWith("/dist/native/subtandem-transport") || contents.has(path),
    read: (path: string) => contents.get(path) ?? null,
    delete: (path: string) => {
      contents.delete(path);
    },
    write: (path: string, value: string) => {
      contents.set(path, value);
      if (!path.endsWith(".request.ready")) return;
      const stem = path.slice(0, -".request.ready".length);
      const current = Number(path.split("/")[2]);
      const request = JSON.parse(contents.get(`${stem}.request.json`)!);
      rpcCalls.push({
        at: Date.now(),
        generation: current,
        path: request.path,
        action: request.body.action,
      });
      if (request.path === "/v2/request" && request.body.purpose === "test")
        providerCalls.push({
          at: Date.now(),
          generation: current,
          requestId: request.body.owner.requestId,
          deadline: request.body.credential.deadlineMs,
        });
      if (current === 1 && expired) return;
      setTimeout(
        () => {
          void (async () => {
            let body: unknown;
            const peer = peers.get(current)!;
            if (request.path === "/v2/health") body = { state: "ok", protocolVersion: 2 };
            else if (request.path === "/v2/credential-channel") {
              const { action, payload } = request.body;
              body =
                action === "operation"
                  ? peer.respond(payload.owner, payload.frame, "synthetic-key")
                  : await peer.call(action, payload);
            } else if (request.path === "/v2/draft-operation") {
              const { action, frame, owner } = request.body;
              if (action !== "begin") body = { state: "closed" };
              else {
                expect(peer.open(owner, frame)).toBe("synthetic-key");
                body = {
                  source: "draft",
                  operationId: `operation-${++sequence}`,
                  channelId: frame.channelId,
                  requestId: frame.context.requestId,
                  owner,
                  purpose: frame.context.purpose,
                  snapshotDigest: frame.context.snapshotDigest,
                  deadlineMs: frame.context.expiresAtMs,
                };
              }
            } else if (request.path === "/v2/request") {
              if (request.body.purpose === "test") {
                if (unavailable) return;
              }
              body = {
                jobId: request.body.jobId,
                transportState: "completed",
                statusCode: 200,
                headers: {},
                bodyText: JSON.stringify(
                  request.body.method === "GET"
                    ? { data: [{ id: "synthetic-model" }] }
                    : {
                        choices: [
                          {
                            message: {
                              content: JSON.stringify({
                                translations: [{ id: "probe", text: "hola" }],
                              }),
                            },
                          },
                        ],
                      },
                ),
              };
            } else body = { state: "unknown" };
            contents.set(
              `${stem}.response.json`,
              JSON.stringify({
                type: "response",
                protocolVersion: 2,
                createdAtMs: Date.now(),
                statusCode: 200,
                body,
              }),
            );
          })().catch(() => undefined);
        },
        request.path === "/v2/request" ? 800 : 20,
      );
    },
  };
  vi.doMock("../../src/adapters/iina/transport-process.js", async (original) => ({
    ...(await original<Record<string, unknown>>()),
    TransportProcess: class {
      static async bootstrap() {
        const current = ++generation;
        peers.set(current, new CredentialPeer());
        return {
          port: 49152 + current,
          token: `synthetic-token-${current}`,
          rpcDirectory: `/rpc/${current}`,
        };
      }
    },
  }));
  vi.doMock("../../src/providers/profile-activation.js", async (original) => ({
    ...(await original<Record<string, unknown>>()),
    restoreProfileActivationAuthority: async (options: { profiles: ProviderProfiles }) => {
      options.profiles.hydrate([profile]);
      return createTestProfileAuthority(options.profiles, { [profile.profileId]: true });
    },
  }));
  const event = new FakeIinaEvent();
  const globalListeners = new Map<string, (data: unknown) => void>();
  let sidebar: ReturnType<typeof sidebarHarness> | null = null;
  const sidebarListeners = new Map<string, (data: unknown) => void>();
  const stateWrites: number[] = [];
  const deliveries: Array<{
    at: number;
    name: string;
    requestId?: unknown;
    ok?: unknown;
    code?: unknown;
  }> = [];
  let throttled = false;
  const runtime = {
    console: { log() {} },
    event,
    file: files,
    core: {
      getVersion: () => ({ iina: "1.4.4" }),
      status: { url: "file:///synthetic.mp4", paused: true, position: 0, isNetworkResource: false },
      subtitle: { id: null, tracks: [] },
      window: { loaded: true, visible: true, fullscreen: false },
    },
    mpv: { getNative() {}, getNumber: () => 0, getFlag: () => false },
    overlay: {
      simpleMode() {},
      loadFile() {},
      setClickable() {},
      show() {},
      hide() {},
      postMessage() {},
      onMessage() {},
    },
    preferences: {
      get: (key: string) => (key === "enabledByDefault" ? false : undefined),
      set() {},
      sync() {},
    },
    global: {
      onMessage: (name: string, callback: (data: unknown) => void) =>
        globalListeners.set(name, callback),
      postMessage: (name: string, data: unknown) => globalListeners.get(name)?.(data),
    },
    utils: {
      resolvePath: (path: string) =>
        path === "@data/." ? "/plugins/.data/io.subtandem.iina" : path,
    },
    sidebar: {
      loadFile: () => sidebarListeners.clear(),
      onMessage: (name: string, callback: (data: unknown) => void) =>
        sidebarListeners.set(name, callback),
      postMessage: (name: string, data: unknown) => {
        if (name === "state:update") stateWrites.push(Date.now());
        else
          deliveries.push({
            at: Date.now(),
            name,
            requestId: (data as any)?.requestId,
            ok: (data as any)?.ok,
            code: (data as any)?.code,
          });
        sidebar?.receive(name, data);
      },
    },
  };
  vi.stubGlobal("iina", runtime);
  await import("../../src/global.js");
  await import("../../src/main.js");
  await vi.advanceTimersByTimeAsync(100);
  const h = sidebarHarness({
    timers: {
      setTimeout,
      clearTimeout,
      clearInterval,
      setInterval: ((callback: () => void, delay: number) => {
        let last = Date.now();
        return setInterval(() => {
          if (throttled && Date.now() - last < 1_000) return;
          last = Date.now();
          callback();
        }, delay);
      }) as typeof setInterval,
    },
    postMessage: (name, data) => sidebarListeners.get(name)?.(data),
  });
  sidebar = h;
  h.receive("state:update", { profiles: [{ ...profile, credentialConfigured: true }] });
  h.evaluate(`loadEditor(profiles.get(${JSON.stringify(profile.profileId)}))`);
  await vi.advanceTimersByTimeAsync(15_000);
  expect(h.element("#provider-key").value).toBe("synthetic-key");
  return {
    h,
    providerCalls,
    rpcCalls,
    deliveries,
    stateWrites,
    starts: () => generation,
    suspend: (duration = 300_001, retireHelper = true) => {
      expired = retireHelper;
      vi.setSystemTime(Date.now() + duration);
    },
    unavailable: (value: boolean) => {
      unavailable = value;
    },
    throttle: () => {
      throttled = true;
    },
    close: () => {
      h.event("pagehide");
      event.trigger("iina.window-will-close");
      globalListeners.clear();
    },
  };
}

afterEach(() => {
  vi.doUnmock("../../src/adapters/iina/transport-process.js");
  vi.doUnmock("../../src/providers/profile-activation.js");
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("Profile Test with a suspended Overlay clock", () => {
  it("completes explicit retries when WebView interval delivery is throttled after suspend", async () => {
    const context = await host();
    try {
      context.h.element("#test-profile").dispatch("click");
      await vi.advanceTimersByTimeAsync(9_999);
      expect(context.h.element("#profile-test-status").textContent).toBe("Test passed");
      context.suspend();
      context.throttle();
      const start = Date.now();
      context.h.element("#test-profile").dispatch("click");
      await vi.advanceTimersByTimeAsync(10_000);
      context.h.element("#test-profile").dispatch("click");
      await vi.advanceTimersByTimeAsync(9_999);
      expect(
        context.h.element("#profile-test-status").textContent,
        JSON.stringify(
          [...context.rpcCalls, ...context.deliveries]
            .filter((call) => call.at >= start)
            .map((call) => ({ ...call, at: call.at - start })),
        ),
      ).toBe("Test passed");
      expect(context.starts()).toBe(2);
      expect(context.providerCalls).toHaveLength(3);
      expect(context.providerCalls.every((call) => call.at < call.deadline)).toBe(true);
    } finally {
      context.close();
    }
  });

  it("recovers the same player after only its mailbox heartbeat expires", async () => {
    const context = await host();
    try {
      context.suspend(90_001, false);
      context.h.element("#test-profile").dispatch("click");
      await vi.advanceTimersByTimeAsync(10_000);
      expect(context.h.element("#test-profile").disabled).toBe(false);
      expect(context.h.element("#profile-test-status").textContent).not.toBe("Testing…");
      context.h.element("#test-profile").dispatch("click");
      await vi.advanceTimersByTimeAsync(9_999);
      expect(context.h.element("#profile-test-status").textContent).toBe("Test passed");
      expect(context.starts()).toBe(1);
      expect(context.providerCalls).toHaveLength(1);
    } finally {
      context.close();
    }
  });

  it("recovers the helper and completes repeated explicit Tests within the click deadline", async () => {
    const context = await host();
    try {
      context.h.element("#test-profile").dispatch("click");
      await vi.advanceTimersByTimeAsync(9_999);
      expect(context.h.element("#profile-test-status").textContent).toBe("Test passed");
      context.suspend();
      context.h.element("#test-profile").dispatch("click");
      await vi.advanceTimersByTimeAsync(10_000);
      expect(context.starts()).toBe(2);
      const resumedResult = context.h.element("#profile-test-status").textContent;
      context.h.element("#test-profile").dispatch("click");
      await vi.advanceTimersByTimeAsync(10_000);
      expect(resumedResult).toBe("Test passed");
      expect(context.h.element("#profile-test-status").textContent).toBe("Test passed");
      expect(context.providerCalls).toHaveLength(3);
      expect(new Set(context.providerCalls.map((call) => call.requestId)).size).toBe(3);
    } finally {
      context.close();
    }
  });

  it("times out an unresponsive service and succeeds on the next explicit Test without fast state refreshes", async () => {
    const context = await host();
    try {
      const start = Date.now();
      context.unavailable(true);
      context.h.element("#test-profile").dispatch("click");
      await vi.advanceTimersByTimeAsync(10_000);
      expect(context.h.element("#profile-test-status").textContent).toContain("timed out");
      expect(context.h.element("#test-profile").disabled).toBe(false);
      context.unavailable(false);
      context.h.element("#test-profile").dispatch("click");
      await vi.advanceTimersByTimeAsync(9_999);
      expect(context.h.element("#profile-test-status").textContent).toBe("Test passed");
      const refreshes = context.stateWrites.filter((at) => at > start);
      expect(refreshes).toHaveLength(26);
      expect(refreshes.slice(1).every((at, index) => at - refreshes[index]! >= 750)).toBe(true);
    } finally {
      context.close();
    }
  });
});
