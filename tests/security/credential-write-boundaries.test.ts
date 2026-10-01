import { describe, expect, it } from "vitest";
import { GlobalMailbox, MainGlobalMailbox } from "../../src/adapters/iina/global-mailbox.js";
import {
  IinaFileRpcBridge,
  IinaProcessLauncher,
} from "../../src/adapters/iina/provider-transport.js";
import { TransportProcess } from "../../src/adapters/iina/transport-process.js";
import { CredentialWriteObserver } from "../helpers/credential-write-observer.js";
import { encryptedSaveFrame, encryptedSaveOwner } from "../helpers/encrypted-profile-fixture.js";
import { ProviderProfiles } from "../../src/providers/profiles.js";

const secret = "synthetic-write-key-雪";
const profile = new ProviderProfiles(() => "10000000-0000-4000-8000-000000000001").save({
  displayName: "Synthetic",
  kind: "openai",
  endpoint: "https://example.test/v1",
  model: "model-a",
  proxyMode: "direct",
});
const payload = {
  owner: encryptedSaveOwner,
  frame: encryptedSaveFrame({ profiles: [profile], activation: null }, secret),
};

describe("production credential file write boundaries", () => {
  it("captures actual helper launch arguments before exec without credential or stdout hooks", async () => {
    const files = new CredentialWriteObserver();
    let launched = false;
    const launcher = new IinaProcessLauncher({
      exec: (executable: string, args: string[], ...hooks: unknown[]) => {
        files.write("@process/exec", JSON.stringify({ executable, args, hooks }));
        launched = true;
        return Promise.resolve({ status: 0, stdout: secret, stderr: secret });
      },
    } as unknown as IINA.API.Utils);
    const session = await TransportProcess.bootstrap(
      launcher,
      {
        exists: () => launched,
        read: () =>
          JSON.stringify({
            type: "ready",
            port: 49152,
            token: "synthetic-rpc-token",
            protocolVersion: 2,
            createdAtMs: Date.now(),
          }),
        delete: () => undefined,
      },
      { dataDirectory: "/synthetic" },
    );
    expect(session.rpcDirectory).toContain("transport-v2-");
    const launch = JSON.parse(files.writes[0]!.content);
    expect(launch.args).toEqual([
      "launch",
      "--data-directory",
      "/synthetic",
      "--ready-file",
      expect.stringContaining("/.ready/transport-"),
      "--rpc-session",
      session.rpcSessionId,
    ]);
    expect(launch.hooks).toEqual([]);
    expect(files.leakedWrites(secret)).toEqual([]);
  });

  it("captures the production mailbox diagnostic sink before logging a secret-bearing I/O failure", () => {
    class FailingFiles extends CredentialWriteObserver {
      fail = false;
      override list(path: string) {
        if (this.fail) throw new Error(secret);
        return super.list(path);
      }
    }
    const files = new FailingFiles();
    const ticks: Array<() => void> = [];
    const main = new MainGlobalMailbox(files, "window-a", {
      root: "/synthetic",
      onError: (code) => files.write("@console/log", code),
      timers: {
        setInterval: (callback) => {
          ticks.push(callback);
          return { cancel() {} };
        },
      },
    });
    files.fail = true;
    ticks[0]!();
    files.fail = false;
    main.close();
    expect(
      files.writes.filter((entry) => entry.path === "@console/log").map((entry) => entry.content),
    ).toEqual(["MAILBOX_POLL_FAILED"]);
    expect(files.leakedWrites(secret)).toEqual([]);
  });

  it("observes Main/Global handoff bytes before files disappear", async () => {
    const files = new CredentialWriteObserver();
    const callbacks: Array<() => void> = [];
    const options = {
      root: "/synthetic",
      timers: {
        setInterval(callback: () => void) {
          callbacks.push(callback);
          return { cancel() {} };
        },
      },
    };
    const global = new GlobalMailbox(files, options);
    const main = new MainGlobalMailbox(files, "window-a", options);
    global.onMessage("profile:save-commit", (data, sender) =>
      global.postMessage(sender!, "profile:save-result", data),
    );
    main.postMessage("profile:save-commit", payload);
    for (const callback of callbacks) callback();
    await Promise.resolve();
    await Promise.resolve();
    for (const callback of callbacks) callback();
    main.close();
    global.close();
    expect(
      files.writes.some(
        (entry) => entry.path.includes("request") && entry.content.includes("sealedPayload"),
      ),
    ).toBe(true);
    expect(
      files.writes.some(
        (entry) => entry.path.includes("response") && entry.content.includes("sealedPayload"),
      ),
    ).toBe(true);
    expect(files.leakedWrites(secret)).toEqual([]);
    expect([...files.contents.values()].join("")).not.toContain(secret);
  });

  it("observes encrypted FileRPC requests and close cleanup at the actual file.write seam", async () => {
    const files = new CredentialWriteObserver();
    const bridge = new IinaFileRpcBridge(files, {
      helper: "transport",
      fileDirectory: "/synthetic/.rpc",
      maxRequestBytes: 2097152,
      maxResponseBytes: 4194304,
      maxConcurrentRequests: 4,
      timers: { setInterval: () => ({ cancel() {} }) },
    });
    const work = bridge.post(12345, "synthetic-rpc-token", "/v2/profile-state", {
      action: "save",
      ...payload,
    });
    await Promise.resolve();
    await Promise.resolve();
    expect(
      files.writes.some(
        (entry) => entry.path.endsWith("request.json") && entry.content.includes("sealedPayload"),
      ),
    ).toBe(true);
    expect(files.writes.some((entry) => entry.path.endsWith("request.ready"))).toBe(true);
    bridge.close();
    await expect(work).rejects.toThrow("HELPER_RPC_CLOSED");
    expect(files.leakedWrites(secret)).toEqual([]);
    expect(files.contents.size).toBe(0);
  });

  it("detects a transient raw, escaped, nested or property-name leak even after deletion", () => {
    const files = new CredentialWriteObserver();
    for (const [index, content] of [
      secret,
      JSON.stringify({ value: secret }).replaceAll("雪", "\\u96ea"),
      JSON.stringify({ nested: JSON.stringify({ value: secret }) }),
      JSON.stringify({ [secret]: true }),
    ].entries()) {
      files.write(`/synthetic/${index}`, content);
      files.delete(`/synthetic/${index}`);
    }
    expect(files.leakedWrites(secret)).toHaveLength(4);
    expect(files.contents.size).toBe(0);
  });
});

it("keeps recovery intents free of draft credentials through cancellation and retry", async () => {
  const files = new CredentialWriteObserver();
  for (let attempt = 0; attempt < 2; attempt++) {
    const bridge = new IinaFileRpcBridge(files, {
      helper: "transport",
      fileDirectory: "/synthetic/.rpc",
      maxRequestBytes: 2097152,
      maxResponseBytes: 4194304,
      maxConcurrentRequests: 4,
      timers: { setInterval: () => ({ cancel() {} }) },
    });
    const client = new (await import("../../src/transport/client.js")).TransportClient(
      { port: 12345, token: "synthetic-rpc-token" },
      bridge,
    );
    const pending = client.profileStateRecover(
      "10000000-0000-4000-8000-000000000009",
      Date.now() + 15_000,
    );
    const rejected = expect(pending).rejects.toThrow();
    await Promise.resolve();
    await Promise.resolve();
    bridge.close();
    await rejected;
  }
  const written = files.writes
    .filter((entry) => entry.path.endsWith("request.json"))
    .map((entry) => JSON.parse(entry.content).body);
  expect(written).toHaveLength(2);
  expect(JSON.stringify(files.writes)).not.toContain(secret);
  expect(files.leakedWrites(secret)).toEqual([]);
  expect(files.contents.size).toBe(0);
});
