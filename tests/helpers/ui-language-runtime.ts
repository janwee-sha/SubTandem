import { vi } from "vitest";
import { sidebarHarness } from "./sidebar-harness.js";
import { createTestProfileAuthority } from "./profile-activation-harness.js";
import type { ProviderProfiles } from "../../src/providers/profiles.js";

export interface LanguageWindowOptions {
  version?: unknown;
  preferred?: unknown;
  missingApi?: boolean;
  throwVersion?: boolean;
  throwLanguage?: boolean;
  holdSnapshots?: boolean;
}

export async function uiLanguageRuntime(
  options: { nativePicker?: boolean; badReadyLocale?: boolean } = {},
) {
  const nativeEvents: any[] = [];
  let nativeRevision = 0;
  let nativeActive: { requestId: string; kind: string; color?: unknown } | null = null;
  const nativeEvent = (event: any) => {
    nativeEvents.push({ ...event, revision: ++nativeRevision });
    if (event.type !== "color-preview" && event.type !== "font-catalog-changed")
      nativeActive = null;
  };
  vi.resetModules();
  const files = new Map<string, string>();
  const frames: Array<{ path: string; content: string; frame: any }> = [];
  const clocks: Array<{ pulse(): void }> = [];
  let dropLanguage = false;
  const droppedResponses = new Set<string>();
  const file = {
    list: (path: string) =>
      [...files.keys()]
        .filter((key) => key.startsWith(path))
        .map((key) => ({ filename: key.slice(path.length), isDir: false })),
    exists: (path: string) =>
      files.has(path) ||
      Boolean(
        options.nativePicker &&
        path ===
          "/private/Plugins/io.subtandem.iina.iinaplugin/dist/native/SubTandemStylePicker.app/Contents/MacOS/subtandem-style-picker",
      ),
    read: (path: string) => files.get(path) ?? null,
    write: (path: string, content: string) => {
      if (path.endsWith(".json")) {
        const frame = JSON.parse(content);
        frames.push({ path, content, frame });
        if (
          (dropLanguage && frame.name === "ui-language:state") ||
          (frame.direction === "response" && droppedResponses.has(frame.name))
        )
          return;
      }
      files.set(path, content);
    },
    delete: (path: string) => files.delete(path),
    handle: () => ({ readToEnd: () => null, close() {} }),
  };
  const preferences = {
    get: (key: string) => (key === "enabledByDefault" ? false : undefined),
    set: vi.fn(),
    sync: vi.fn(),
  };
  const exec = vi.fn(async (path: string, args: string[]) => {
    if (
      !options.nativePicker ||
      !path.endsWith("SubTandemStylePicker.app/Contents/MacOS/subtandem-style-picker")
    )
      throw new Error("Unexpected native execution");
    files.set(
      `@data/.ready/${args[2]!.split("/").at(-1)}`,
      JSON.stringify({
        type: "ready",
        protocolVersion: 2,
        port: 49152,
        token: "opaque-token",
        createdAtMs: Date.now(),
        uiLocale: options.badReadyLocale ? "ar" : args[4],
      }),
    );
    return { status: 0 };
  });
  const network = vi.fn(async (url: string, request: any) => {
    if (!options.nativePicker || !url.startsWith("http://127.0.0.1:49152/v1/"))
      throw new Error("Unexpected network request");
    if (request.headers.Authorization !== "Bearer opaque-token")
      throw new Error("Unauthorized fake picker");
    const body = request.data;
    let data: any;
    if (url.includes("/events?")) {
      const after = Number(url.split("after=")[1]);
      data = {
        events: nativeEvents.filter((event) => event.revision > after),
        earliestRevision: nativeEvents[0]?.revision ?? nativeRevision,
        latestRevision: nativeRevision,
      };
    } else if (url.endsWith("/font/status"))
      data = { availability: "available", catalogRevision: 1 };
    else if (url.endsWith("/open")) {
      data = { status: nativeActive ? "focused" : "opened" };
      if (!nativeActive)
        nativeActive = { ...body, kind: url.includes("/font/") ? "font" : "color" };
    } else if (url.endsWith("/activate"))
      data = { status: nativeActive ? "activated" : "unchanged" };
    else if (url.endsWith("/cancel")) {
      data = { status: nativeActive?.requestId === body.requestId ? "cancelled" : "unchanged" };
      if (nativeActive?.requestId === body.requestId)
        nativeEvent(
          nativeActive.kind === "font"
            ? { requestId: body.requestId, type: "font-cancelled" }
            : {
                requestId: body.requestId,
                type: "color-closed",
                changed: false,
                color: nativeActive.color,
              },
        );
    } else if (url.endsWith("/shutdown")) {
      nativeActive = null;
      data = { status: "shutting-down" };
    } else throw new Error("Unexpected picker operation");
    return { statusCode: 200, data };
  });
  const globalHandlers = new Map<string, (...args: unknown[]) => unknown>();
  const utils = {
    resolvePath: (path: string) =>
      options.nativePicker && path === "@data/."
        ? "/private/Plugins/.data/io.subtandem.iina"
        : path,
    exec,
  };
  vi.stubGlobal("iina", {
    file,
    preferences,
    utils,
    console: { log: vi.fn() },
    http: { get: network, post: network },
    global: {
      onMessage: (name: string, callback: (...args: unknown[]) => unknown) =>
        globalHandlers.set(name, callback),
    },
  });
  vi.doMock("../../src/providers/profile-activation.js", async (original) => ({
    ...(await original<Record<string, unknown>>()),
    restoreProfileActivationAuthority: async ({
      profiles,
      authorityId,
    }: {
      profiles: ProviderProfiles;
      authorityId: string;
    }) => createTestProfileAuthority(profiles, {}, authorityId),
  }));
  await import("../../src/global.js");
  clocks.push((await import("../../src/adapters/iina/host-timers.js")).hostClock);
  const pump = async (steps = 6) => {
    for (let index = 0; index < steps; index++) {
      await vi.advanceTimersByTimeAsync(50);
      for (const clock of clocks) clock.pulse();
      await Promise.resolve();
    }
  };
  return {
    nativeEvent,
    injectResponse(name: string, data: unknown, targetId?: string) {
      const previous = [...frames]
        .reverse()
        .find(
          (entry) =>
            entry.frame.direction === "response" &&
            (!targetId || entry.frame.targetId === targetId),
        );
      if (!previous) throw new Error("Missing response route");
      const frame = { ...previous.frame, name, data };
      files.set(previous.path, JSON.stringify(frame));
      files.set(previous.path.replace(/\.json$/, ".ready"), "");
    },
    dropResponse(name: string, drop: boolean) {
      if (drop) droppedResponses.add(name);
      else droppedResponses.delete(name);
    },
    frames,
    files,
    preferences,
    exec,
    network,
    pump,
    dropLanguage(value: boolean) {
      dropLanguage = value;
    },
    async addWindow(options: LanguageWindowOptions = {}) {
      vi.resetModules();
      const events = new Map<string, Map<string, (...args: unknown[]) => unknown>>();
      const sidebarHandlers = new Map<string, (value: unknown) => unknown>();
      const messages: Array<{ name: string; data: any }> = [];
      const version = vi.fn(() => {
        if (options.throwVersion) throw new Error("version failed");
        return { iina: options.version ?? "1.5.0" };
      });
      const preferred = vi.fn(() => {
        if (options.throwLanguage) throw new Error("language failed");
        return options.preferred ?? ["de"];
      });
      let sidebar: ReturnType<typeof sidebarHarness>;
      let hold = options.holdSnapshots ?? false;
      let listenerSequence = 0;
      const runtime = {
        http: { get: network, post: network },
        file,
        preferences,
        console: { log: vi.fn() },
        global: { postMessage: (name: string, data: unknown) => globalHandlers.get(name)?.(data) },
        core: {
          getVersion: version,
          window: { loaded: true, visible: true, fullscreen: false },
          status: {
            paused: false,
            position: 0,
            url: "file:///synthetic/movie.mkv",
            isNetworkResource: false,
          },
          subtitle: { id: null, tracks: [], currentTrack: null },
        },
        utils: { ...utils, ...(options.missingApi ? {} : { preferredLocalizations: preferred }) },
        event: {
          on: (name: string, callback: (...args: unknown[]) => unknown) => {
            const id = `listener-${++listenerSequence}`;
            const map = events.get(name) ?? new Map();
            map.set(id, callback);
            events.set(name, map);
            return id;
          },
          off: (name: string, id: string) => events.get(name)?.delete(id),
        },
        mpv: { getNative: () => undefined, getNumber: () => 0, getFlag: () => false },
        overlay: {
          simpleMode() {},
          loadFile() {},
          setClickable() {},
          show() {},
          hide() {},
          postMessage() {},
          onMessage() {},
        },
        sidebar: {
          loadFile() {
            sidebar = sidebarHarness({
              postMessage: (name, data) => sidebarHandlers.get(name)?.(data),
            });
          },
          onMessage: (name: string, callback: (value: unknown) => unknown) =>
            sidebarHandlers.set(name, callback),
          postMessage(name: string, data: unknown) {
            messages.push({ name, data });
            if (!(hold && name === "state:update")) sidebar.receiveRaw(name, structuredClone(data));
          },
        },
      };
      vi.stubGlobal("iina", runtime);
      await import("../../src/main.js");
      clocks.push((await import("../../src/adapters/iina/host-timers.js")).hostClock);
      await vi.advanceTimersByTimeAsync(100);
      sidebarHandlers.get("ui:poll")?.({});
      await pump();
      return {
        runtime,
        messages,
        version,
        preferred,
        get sidebar() {
          return sidebar;
        },
        get state() {
          return messages.filter((entry) => entry.name === "state:update").at(-1)?.data;
        },
        send(name: string, data: unknown) {
          sidebarHandlers.get(name)?.(data);
        },
        poll() {
          sidebarHandlers.get("ui:poll")?.({});
        },
        reload() {
          sidebar = sidebarHarness({
            postMessage: (name, data) => sidebarHandlers.get(name)?.(data),
          });
          sidebarHandlers.get("ui:ready")?.({});
        },
        releaseSnapshot() {
          hold = false;
          const state = messages.filter((entry) => entry.name === "state:update").at(-1);
          if (state) sidebar.receiveRaw(state.name, structuredClone(state.data));
        },
        close() {
          for (const callback of events.get("iina.window-will-close")?.values() ?? []) callback();
          sidebar.event("pagehide");
        },
      };
    },
  };
}
