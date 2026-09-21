import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SubtitlePreparationCoordinator } from "../../src/app/subtitle-preparation.js";
import { utf8Encode } from "../../src/domain/codec.js";
import { sha256Hex } from "../../src/domain/identity.js";
import type {
  SubtitleSelectionSnapshot,
  SubtitleSourcePort,
} from "../../src/adapters/iina/subtitle-source.js";

type SelectionKind = "external" | "embedded";

const subtitleBytes = utf8Encode("1\n00:00:01,000 --> 00:00:02,000\nHello\n");
const jobId = "7a90a4e6-cc4f-4f59-99b7-8ff522f887ae";

interface Counts {
  preferenceReads: number;
  selectionReads: number;
  subtitleReads: number;
  bootstrapCalls: number;
  prepareCalls: number;
  retryCalls: number;
}

interface RuntimeHarness {
  runtime: Record<PropertyKey, unknown>;
  counts: Counts;
  trace: string[];
  setSelection(kind: SelectionKind): void;
  triggerEvent(name: string, ...args: unknown[]): void;
  triggerSidebar(name: string, data?: unknown): void;
  states(): Array<Record<string, unknown>>;
  close(): void;
}

interface MainSubtitleSourcePort extends SubtitleSourcePort {
  selectionSnapshot(): SubtitleSelectionSnapshot | null;
}

interface MainPlayerDependencies {
  createSourcePort?: (mediaEpoch: () => number) => MainSubtitleSourcePort;
  createPreparationCoordinator?: (
    readResult: (resultId: string) => Uint8Array | null,
  ) => Promise<SubtitlePreparationCoordinator>;
}

interface HarnessOptions {
  enabled: boolean;
  selection: SelectionKind;
  createCoordinator?: () => Promise<SubtitlePreparationCoordinator>;
}

function coordinatorWith(
  prepare: () => Promise<{
    jobId: string;
    state: "ready";
    resultId: string;
    format: "srt";
    cueCount: number;
    byteCount: number;
    sha256: string;
  }>,
  counts: Counts,
): SubtitlePreparationCoordinator {
  return new SubtitlePreparationCoordinator({
    playerId: "player",
    extractor: {
      prepare: async () => {
        counts.prepareCalls += 1;
        return prepare();
      },
      cancel: async () => "cancelled",
      release: async () => undefined,
      shutdown: async () => undefined,
    },
    readResult: () => subtitleBytes,
    createId: () => jobId,
  });
}

function createHarness(options: HarnessOptions): RuntimeHarness {
  const counts: Counts = {
    preferenceReads: 0,
    selectionReads: 0,
    subtitleReads: 0,
    bootstrapCalls: 0,
    prepareCalls: 0,
    retryCalls: 0,
  };
  const trace: string[] = [];
  let selection = options.selection;
  const eventListeners = new Map<string, Map<string, (...args: unknown[]) => void>>();
  const sidebarListeners = new Map<string, (data: unknown) => void>();
  const sidebarMessages: Array<{ name: string; data: unknown }> = [];
  const files = new Map<string, string>();
  let nextListenerId = 0;
  const runtime: Record<PropertyKey, unknown> = {
    console: { log: () => undefined },
    core: {
      status: {
        url: "file:///private/movie.mkv",
        isNetworkResource: false,
        paused: false,
        position: 0,
      },
      subtitle: {
        id: 7,
        tracks: [{ id: 7, isExternal: selection === "external", title: "English" }],
        currentTrack: { id: 7, isExternal: selection === "external", title: "English" },
      },
      window: { fullscreen: false, loaded: true },
    },
    event: {
      on: (name: string, callback: (...args: unknown[]) => void) => {
        const id = `event-${++nextListenerId}`;
        const listeners = eventListeners.get(name) ?? new Map();
        listeners.set(id, callback);
        eventListeners.set(name, listeners);
        return id;
      },
      off: (name: string, id: string) => eventListeners.get(name)?.delete(id),
    },
    file: {
      list: (path: string) =>
        [...files.keys()]
          .filter((item) => item.startsWith(path))
          .map((item) => ({ filename: item.slice(path.length), isDir: false })),
      exists: (path: string) => files.has(path),
      read: (path: string) => files.get(path) ?? null,
      write: (path: string, value: string) => files.set(path, value),
      delete: (path: string) => files.delete(path),
      handle: () => ({ readToEnd: () => null, close: () => undefined }),
    },
    mpv: {
      getNative: () => undefined,
      getNumber: () => 0,
      getFlag: () => false,
    },
    overlay: {
      simpleMode: () => undefined,
      loadFile: () => undefined,
      setClickable: () => undefined,
      show: () => undefined,
      hide: () => undefined,
      postMessage: () => undefined,
      onMessage: () => undefined,
    },
    preferences: {
      get: (key: string) => {
        if (key === "enabledByDefault") counts.preferenceReads += 1;
        trace.push(`preference:${key}`);
        return key === "enabledByDefault" ? options.enabled : undefined;
      },
      set: () => undefined,
      sync: () => undefined,
    },
    sidebar: {
      loadFile: () => undefined,
      onMessage: (name: string, callback: (data: unknown) => void) =>
        sidebarListeners.set(name, callback),
      postMessage: (name: string, data: unknown) => sidebarMessages.push({ name, data }),
    },
    utils: {
      resolvePath: (path: string) => path,
      exec: async () => ({ status: 0 }),
    },
  };
  const dependencies: MainPlayerDependencies = {
    createSourcePort: (mediaEpoch) => ({
      selectionSnapshot: () => {
        counts.selectionReads += 1;
        trace.push("selection");
        return {
          playerId: "player",
          mediaEpoch: mediaEpoch(),
          mediaUrl: "file:///private/movie.mkv",
          isNetworkResource: false,
          selectedTrackId: 7,
          tracks: [
            selection === "external"
              ? {
                  type: "sub",
                  id: 7,
                  selected: true,
                  "main-selection": 0,
                  external: true,
                  codec: "subrip",
                }
              : {
                  type: "sub",
                  id: 7,
                  selected: true,
                  "main-selection": 0,
                  external: false,
                  codec: "subrip",
                  "ff-index": 3,
                },
          ],
        };
      },
      selectedTrack: () => {
        counts.selectionReads += 1;
        trace.push("selected-track");
        return { id: 7, isExternal: selection === "external" };
      },
      readBinary: () => {
        counts.subtitleReads += 1;
        trace.push("subtitle-read");
        return subtitleBytes;
      },
    }),
    createPreparationCoordinator: async () => {
      counts.bootstrapCalls += 1;
      trace.push("bootstrap");
      return options.createCoordinator
        ? options.createCoordinator()
        : coordinatorWith(
            async () => ({
              jobId,
              state: "ready",
              resultId: jobId,
              format: "srt",
              cueCount: 1,
              byteCount: subtitleBytes.length,
              sha256: sha256Hex(subtitleBytes),
            }),
            counts,
          );
    },
  };
  runtime[Symbol.for("subtandem.main-player-dependencies")] = dependencies;
  return {
    runtime,
    counts,
    trace,
    setSelection: (kind) => {
      selection = kind;
    },
    triggerEvent: (name, ...args) => {
      for (const callback of eventListeners.get(name)?.values() ?? []) callback(...args);
    },
    triggerSidebar: (name, data = {}) => sidebarListeners.get(name)?.(data),
    states: () =>
      sidebarMessages
        .filter((message) => message.name === "state:update")
        .map((message) => message.data as Record<string, unknown>),
    close: () => {
      for (const callback of eventListeners.get("iina.window-will-close")?.values() ?? [])
        callback();
    },
  };
}

async function startHarness(harness: RuntimeHarness): Promise<void> {
  vi.resetModules();
  vi.stubGlobal("iina", harness.runtime);
  await import("../../src/main.js");
  await vi.advanceTimersByTimeAsync(100);
}

async function settle(): Promise<void> {
  for (let index = 0; index < 8; index += 1) await Promise.resolve();
  await vi.advanceTimersByTimeAsync(0);
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("translation-disabled Main startup", () => {
  it.each(["external", "embedded"] as const)(
    "does no subtitle work for a persisted disabled %s selection across every loading entry",
    async (selection) => {
      const harness = createHarness({ enabled: false, selection });
      await startHarness(harness);

      expect(harness.trace.indexOf("preference:enabledByDefault")).toBeLessThan(
        harness.trace.findIndex((entry) =>
          ["selection", "selected-track", "subtitle-read", "bootstrap"].includes(entry),
        ) === -1
          ? Number.POSITIVE_INFINITY
          : harness.trace.findIndex((entry) =>
              ["selection", "selected-track", "subtitle-read", "bootstrap"].includes(entry),
            ),
      );
      harness.triggerSidebar("ui:ready");
      harness.triggerSidebar("ui:ready");
      harness.triggerEvent("iina.file-loaded");
      harness.triggerEvent("mpv.sid.changed");
      harness.triggerEvent("mpv.track-list.changed");
      await vi.advanceTimersByTimeAsync(2_000);
      harness.triggerSidebar("ui:poll");

      expect(harness.counts).toMatchObject({
        preferenceReads: 1,
        selectionReads: 0,
        subtitleReads: 0,
        bootstrapCalls: 0,
        prepareCalls: 0,
        retryCalls: 0,
      });
      expect(harness.states().at(-1)).toMatchObject({
        status: "disabled",
        source: null,
        sourceIssue: null,
        sourcePreparation: null,
      });
      harness.close();
    },
  );

  it("rejects Retry while disabled without creating an attempt", async () => {
    const harness = createHarness({ enabled: false, selection: "embedded" });
    await startHarness(harness);

    harness.triggerSidebar("subtitle:retry-preparation", {
      requestId: "retry-disabled",
      revision: 1,
      payload: {},
    });
    harness.triggerSidebar("ui:poll");

    expect(harness.counts.bootstrapCalls).toBe(0);
    expect(harness.counts.prepareCalls).toBe(0);
    expect(harness.states().at(-1)).toMatchObject({
      status: "disabled",
      source: null,
      sourceIssue: null,
      sourcePreparation: null,
    });
    harness.close();
  });

  it("re-evaluates only the current selection once when translation is enabled", async () => {
    const harness = createHarness({ enabled: false, selection: "external" });
    await startHarness(harness);
    harness.triggerEvent("iina.file-loaded");
    harness.triggerEvent("mpv.sid.changed");
    harness.triggerEvent("mpv.track-list.changed");
    await vi.advanceTimersByTimeAsync(1_500);

    harness.triggerSidebar("translation:set-enabled", {
      requestId: "enable-1",
      revision: 1,
      payload: { enabled: true },
    });
    await settle();

    expect(harness.counts.selectionReads).toBe(2);
    expect(harness.counts.subtitleReads).toBe(1);
    expect(harness.counts.bootstrapCalls).toBe(0);
    expect(harness.states().at(-1)).toMatchObject({
      source: { format: "srt", cueCount: 1 },
      sourceIssue: null,
      sourcePreparation: null,
    });
    harness.close();
  });

  it("evaluates a failing embedded selection once after re-enable and creates fresh Retry state", async () => {
    const harness = createHarness({
      enabled: false,
      selection: "embedded",
      createCoordinator: async () =>
        coordinatorWith(async () => {
          throw new Error("synthetic extraction failure");
        }, harness.counts),
    });
    await startHarness(harness);

    harness.triggerSidebar("translation:set-enabled", {
      requestId: "enable-failure",
      revision: 1,
      payload: { enabled: true },
    });
    await settle();
    harness.triggerSidebar("ui:poll");

    expect(harness.counts.selectionReads).toBe(1);
    expect(harness.counts.bootstrapCalls).toBe(1);
    expect(harness.counts.prepareCalls).toBe(1);
    expect(harness.states().at(-1)).toMatchObject({
      source: null,
      sourceIssue: null,
      sourcePreparation: { state: "failed", canRetry: true },
    });
    harness.close();
  });

  it("does not continue from a bootstrap that resolves after translation is disabled", async () => {
    let resolveBootstrap!: (value: SubtitlePreparationCoordinator) => void;
    const bootstrap = new Promise<SubtitlePreparationCoordinator>((resolve) => {
      resolveBootstrap = resolve;
    });
    const harness = createHarness({
      enabled: true,
      selection: "embedded",
      createCoordinator: () => bootstrap,
    });
    await startHarness(harness);
    expect(harness.counts.bootstrapCalls).toBe(1);

    harness.triggerSidebar("translation:set-enabled", {
      requestId: "disable-during-bootstrap",
      revision: 1,
      payload: { enabled: false },
    });
    resolveBootstrap(
      coordinatorWith(
        async () => ({
          jobId,
          state: "ready",
          resultId: jobId,
          format: "srt",
          cueCount: 1,
          byteCount: subtitleBytes.length,
          sha256: sha256Hex(subtitleBytes),
        }),
        harness.counts,
      ),
    );
    await settle();

    expect(harness.counts.prepareCalls).toBe(0);
    harness.triggerSidebar("ui:poll");
    expect(harness.states().at(-1)).toMatchObject({
      status: "disabled",
      source: null,
      sourceIssue: null,
      sourcePreparation: null,
    });
    harness.close();
  });

  it("rejects a preparation result after disable or media replacement", async () => {
    let resolvePrepare!: (value: {
      jobId: string;
      state: "ready";
      resultId: string;
      format: "srt";
      cueCount: number;
      byteCount: number;
      sha256: string;
    }) => void;
    const prepared = new Promise<{
      jobId: string;
      state: "ready";
      resultId: string;
      format: "srt";
      cueCount: number;
      byteCount: number;
      sha256: string;
    }>((resolve) => {
      resolvePrepare = resolve;
    });
    const harness = createHarness({
      enabled: true,
      selection: "embedded",
      createCoordinator: async () => coordinatorWith(() => prepared, harness.counts),
    });
    await startHarness(harness);
    await settle();
    expect(harness.counts.prepareCalls).toBe(1);

    harness.triggerEvent("iina.file-loaded");
    harness.triggerSidebar("translation:set-enabled", {
      requestId: "disable-during-prepare",
      revision: 1,
      payload: { enabled: false },
    });
    resolvePrepare({
      jobId,
      state: "ready",
      resultId: jobId,
      format: "srt",
      cueCount: 1,
      byteCount: subtitleBytes.length,
      sha256: sha256Hex(subtitleBytes),
    });
    await settle();
    harness.triggerSidebar("ui:poll");

    expect(harness.states().at(-1)).toMatchObject({
      status: "disabled",
      source: null,
      sourceIssue: null,
      sourcePreparation: null,
    });
    harness.close();
  });

  it("keeps enabled gates isolated across player instances", async () => {
    const disabled = createHarness({ enabled: false, selection: "external" });
    const enabled = createHarness({ enabled: true, selection: "external" });
    await startHarness(disabled);
    await startHarness(enabled);
    await settle();

    expect(disabled.counts.selectionReads).toBe(0);
    expect(disabled.counts.subtitleReads).toBe(0);
    expect(enabled.counts.selectionReads).toBe(2);
    expect(enabled.counts.subtitleReads).toBe(1);
    disabled.close();
    enabled.close();
  });
});
