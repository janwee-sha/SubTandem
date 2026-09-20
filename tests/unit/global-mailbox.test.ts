import { describe, expect, it, vi } from "vitest";

import {
  GlobalMailbox,
  MainGlobalMailbox,
  type GlobalMailboxFileStore,
} from "../../src/adapters/iina/global-mailbox.js";
import { HostTimers, type HostTimerApi } from "../../src/adapters/iina/host-timers.js";

class MemoryMailboxFiles implements GlobalMailboxFileStore {
  readonly contents = new Map<string, string>();
  readonly writes: string[] = [];

  list(path: string): Array<{ filename: string; isDir: boolean }> {
    return [...this.contents.keys()]
      .filter((item) => item.startsWith(path))
      .map((item) => ({ filename: item.slice(path.length), isDir: false }));
  }

  exists(path: string): boolean {
    return this.contents.has(path);
  }

  read(path: string): string | null {
    return this.contents.get(path) ?? null;
  }

  write(path: string, content: string): void {
    this.contents.set(path, content);
    this.writes.push(path);
  }

  delete(path: string): void {
    this.contents.delete(path);
  }
}

class RetainingTimerApi implements HostTimerApi {
  private sequence = 0;
  readonly timeouts = new Map<number, () => void>();
  readonly intervals = new Map<number, () => void>();

  setTimeout(callback: () => void): number {
    const handle = ++this.sequence;
    this.timeouts.set(handle, callback);
    return handle;
  }

  clearTimeout(handle: unknown): void {
    this.timeouts.delete(handle as number);
  }

  setInterval(callback: () => void): number {
    const handle = ++this.sequence;
    this.intervals.set(handle, callback);
    return handle;
  }

  clearInterval(handle: unknown): void {
    this.intervals.delete(handle as number);
  }

  tick(): void {
    for (const callback of [...this.intervals.values()]) callback();
  }
}

function createHarness(now: () => number = () => 10_000) {
  const files = new MemoryMailboxFiles();
  const api = new RetainingTimerApi();
  const timers = new HostTimers(api);
  const options = { now, nonce: () => "nonce0000001", timers };
  return { files, api, options };
}

describe("file-backed Main and Global mailbox", () => {
  it("routes requests and replies asynchronously with one poller per context", () => {
    const { files, api, options } = createHarness();
    const global = new GlobalMailbox(files, options);
    const main = new MainGlobalMailbox(files, "player-a", options);
    const received = vi.fn();

    global.onMessage("echo", (data, playerId) => {
      expect(playerId).toBe("player-a");
      global.postMessage(playerId!, "echo:result", data);
    });
    main.onMessage("echo:result", received);
    main.postMessage("echo", { value: 7 });
    main.postMessage("echo", { value: 8 });

    const echoPayload = [...files.contents.entries()].find(
      ([path, value]) => path.endsWith(".json") && value.includes('"name":"echo"'),
    )![0];
    const echoReady = echoPayload.replace(/\.json$/, ".ready");
    expect(files.writes.indexOf(echoPayload)).toBeLessThan(files.writes.indexOf(echoReady));

    expect(received).not.toHaveBeenCalled();
    expect(api.intervals.size).toBe(2);
    api.tick();
    expect(received.mock.calls).toEqual([[{ value: 7 }], [{ value: 8 }]]);
    api.tick();
    expect(received).toHaveBeenCalledTimes(2);

    main.close();
    global.close();
    expect(api.intervals.size).toBe(0);
  });

  it("keeps API keys out of mailbox frames and deletes the one-use handoff first", () => {
    const { files, api, options } = createHarness();
    const global = new GlobalMailbox(files, options);
    const main = new MainGlobalMailbox(files, "player-secret", options);
    const received = vi.fn((data: unknown) => {
      expect([...files.contents.keys()].some((path) => path.endsWith(".secrets.json"))).toBe(false);
      expect(data).toEqual({
        requestId: "credential.1",
        payload: { fields: { apiKey: "PRIVATE_TEST_KEY" } },
      });
    });
    global.onMessage("credential:set", received);

    main.postMessage("credential:set", {
      requestId: "credential.1",
      payload: { fields: { apiKey: "PRIVATE_TEST_KEY" } },
    });

    const mailboxFrames = [...files.contents.entries()].filter(
      ([path]) => path.endsWith(".json") && !path.endsWith(".secrets.json"),
    );
    expect(mailboxFrames.some(([, value]) => value.includes("PRIVATE_TEST_KEY"))).toBe(false);
    expect(
      [...files.contents.entries()].some(
        ([path, value]) => path.endsWith(".secrets.json") && value.includes("PRIVATE_TEST_KEY"),
      ),
    ).toBe(true);

    api.tick();
    expect(received).toHaveBeenCalledOnce();
    expect([...files.contents.values()].join("\n")).not.toContain("PRIVATE_TEST_KEY");
    main.close();
    global.close();
  });

  it("uses the frame source as authority across multiple windows and broadcasts independently", () => {
    const { files, api, options } = createHarness();
    const global = new GlobalMailbox(files, options);
    const mainA = new MainGlobalMailbox(files, "player-a", options);
    const mainB = new MainGlobalMailbox(files, "player-b", options);
    const sources: string[] = [];
    const stateA = vi.fn();
    const stateB = vi.fn();
    mainA.onMessage("state", stateA);
    mainB.onMessage("state", stateB);
    global.onMessage("probe", (data, playerId) => {
      sources.push(playerId!);
      expect(data).toEqual({ requestId: "same-id", playerId: "spoofed-player" });
    });

    mainA.postMessage("probe", { requestId: "same-id", playerId: "spoofed-player" });
    mainB.postMessage("probe", { requestId: "same-id", playerId: "spoofed-player" });
    api.tick();
    expect(sources.sort()).toEqual(["player-a", "player-b"]);

    global.postMessage(null, "state", { version: 2 });
    api.tick();
    expect(stateA).toHaveBeenCalledWith({ version: 2 });
    expect(stateB).toHaveBeenCalledWith({ version: 2 });
    mainA.close();
    mainB.close();
    global.close();
  });

  it("drops expired frames and enforces queue depth", () => {
    let currentTime = 10_000;
    const { files, api, options } = createHarness(() => currentTime);
    const global = new GlobalMailbox(files, {
      ...options,
      maxQueueDepth: 2,
      heartbeatIntervalMs: 100_000,
    });
    const main = new MainGlobalMailbox(files, "player-limits", {
      ...options,
      maxQueueDepth: 2,
      heartbeatIntervalMs: 100_000,
    });
    const received = vi.fn();
    global.onMessage("expired", received);
    api.tick();

    main.postMessage("expired", { value: 1 });
    main.postMessage("expired", { value: 2 });
    expect(() => main.postMessage("expired", { value: 3 })).toThrow("MAILBOX_QUEUE_FULL");
    currentTime += 31_000;
    api.tick();
    expect(received).not.toHaveBeenCalled();
    expect([...files.contents.keys()].filter((path) => path.endsWith(".ready"))).toHaveLength(0);
    main.close();
    global.close();
  });

  it("rejects corrupt and oversized frames without invoking handlers", () => {
    const { files, api, options } = createHarness();
    const errors = vi.fn();
    const global = new GlobalMailbox(files, { ...options, onError: errors });
    const main = new MainGlobalMailbox(files, "player-corrupt", options);
    const received = vi.fn();
    global.onMessage("probe", received);
    main.postMessage("probe", { value: 1 });

    const probePayload = [...files.contents.entries()].find(
      ([path, value]) => path.endsWith(".json") && value.includes('"name":"probe"'),
    );
    expect(probePayload).toBeDefined();
    files.contents.set(probePayload![0], "{");
    api.tick();
    expect(received).not.toHaveBeenCalled();
    expect(errors).toHaveBeenCalledWith("MAILBOX_FRAME_REJECTED");

    const limitedMain = new MainGlobalMailbox(files, "player-oversize", {
      ...options,
      maxFrameBytes: 1_024,
    });
    expect(() => limitedMain.postMessage("probe", { value: "x".repeat(2_000) })).toThrow(
      "MAILBOX_FRAME_LIMIT",
    );
    limitedMain.close();
    main.close();
    global.close();
  });

  it("removes a closing window from broadcasts and cleans pending replies", () => {
    const { files, api, options } = createHarness();
    const global = new GlobalMailbox(files, options);
    const main = new MainGlobalMailbox(files, "player-closing", options);
    api.tick();
    global.postMessage("player-closing", "state", { version: 1 });
    expect([...files.contents.keys()].some((path) => path.includes("-response-"))).toBe(true);

    main.close();
    expect([...files.contents.keys()].some((path) => path.includes("-response-"))).toBe(false);
    api.tick();
    global.postMessage(null, "state", { version: 2 });
    global.postMessage("player-closing", "state", { version: 3 });
    expect([...files.contents.keys()].some((path) => path.includes("-response-"))).toBe(false);
    global.close();
  });
});
