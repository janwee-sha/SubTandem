import { vi } from "vitest";
import type { MainRuntime } from "../../src/main.js";
import type { TranslationBatchRequest } from "../../src/providers/types.js";
import type { LoadedSample } from "./language-corpus.js";
import {
  FakeIinaEvent,
  FakeIinaOverlay,
  FakeIinaPlayer,
  FakeIinaPreferences,
} from "./fake-iina.js";

export async function createMainLanguagePlayer(
  sample: LoadedSample,
  options: {
    tag?: string;
    target?: string;
    enabled?: boolean;
    selected?: boolean;
    playerId?: string;
  } = {},
) {
  const event = new FakeIinaEvent();
  const global = new FakeIinaOverlay();
  const sidebar = new FakeIinaOverlay();
  const overlay = new FakeIinaOverlay();
  const mpv = new FakeIinaPlayer();
  const preferences = new FakeIinaPreferences();
  preferences.values.set("enabledByDefault", options.enabled ?? true);
  preferences.values.set("targetLanguage", options.target ?? "ja");
  const logs: string[] = [];
  const files = new Map<string, Uint8Array>([["@sub/1", sample.bytes]]);
  const reads: string[] = [];
  const core = {
    window: { loaded: false, fullscreen: false },
    status: {
      url: "/private/media-secret.mkv",
      isNetworkResource: false,
      position: sample.cues[0]!.startMs / 1000,
      paused: false,
    },
    subtitle: {
      id: 1,
      tracks: [
        { id: 1, isExternal: true, title: `secret.${sample.format}`, lang: options.tag ?? null },
      ],
    },
  };
  mpv.set("track-list", [
    { type: "sub", id: 1, selected: true, "main-selection": 0, external: true },
  ]);
  const runtime = {
    console: {
      log: (value: unknown) => logs.push(String(value)),
      warn: (value: unknown) => logs.push(String(value)),
      error: (value: unknown) => logs.push(String(value)),
    },
    event,
    global,
    sidebar,
    overlay,
    mpv,
    core,
    preferences,
    file: {
      handle: (path: string) => {
        reads.push(path);
        return { readToEnd: () => files.get(path) ?? null, close: () => undefined };
      },
      read: () => null,
      exists: () => false,
      list: () => [],
    },
    http: {
      request: vi.fn(() => {
        throw new Error("Unexpected Main network access");
      }),
    },
    utils: { resolvePath: (path: string) => path },
  };
  vi.stubGlobal("iina", { core: { window: { loaded: false } }, event: { on: () => "bootstrap" } });
  const { wirePlayer } = await import("../../src/main.js");
  const post = global.postMessage.bind(global);
  const requests: TranslationBatchRequest[] = [];
  global.postMessage = (name, data) => {
    post(name, data);
    if (name !== "provider:attempt") return;
    const message = data as { requestId: string; payload: TranslationBatchRequest };
    requests.push(message.payload);
    global.trigger("provider:attempt-result", {
      requestId: message.requestId,
      result: {
        translations: message.payload.items.map((item) => ({
          id: item.id,
          text: `Validation translation ${item.id}`,
        })),
      },
    });
  };
  const controller = wirePlayer(
    runtime as unknown as MainRuntime,
    options.playerId ?? "main-language",
  );
  if (options.selected !== false)
    global.trigger("profile:selected", {
      selection: {
        profileId: "chosen-profile",
        revision: 7,
        endpointFingerprint: "loopback",
        kind: "openai",
      },
    });
  event.trigger("iina.overlay-loaded");
  overlay.trigger("overlay:ready");
  return {
    runtime,
    controller,
    requests,
    logs,
    reads,
    files,
    metrics: () =>
      logs
        .filter((line) => line.startsWith("[SubTandem language detection] "))
        .map((line) => JSON.parse(line.slice("[SubTandem language detection] ".length))),
    state: () => {
      sidebar.trigger("ui:poll");
      return sidebar.messages.filter((message) => message.name === "state:update").at(-1)!.data as {
        source: { detectedLanguage: string | null } | null;
        targetLanguage: string;
      };
    },
    advance: async (ms = 400) => {
      await vi.advanceTimersByTimeAsync(ms);
      await controller.whenIdle();
    },
    close: () => event.trigger("iina.window-will-close"),
  };
}
