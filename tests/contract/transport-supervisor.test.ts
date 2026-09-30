import type { CredentialOwner, CredentialEnvelope } from "../../shared/credential-protocol.js";
import { encryptedSaveFrame, encryptedSaveOwner } from "../helpers/encrypted-profile-fixture.js";
import { describe, expect, it } from "vitest";
import { SubTandemError } from "../../src/domain/errors.js";
import type {
  ProfileStateCommitResult,
  ProfileStateStoreSnapshot,
  TransportRequest,
  TransportResponse,
  TransportRpcClient,
} from "../../src/transport/client.js";
import { TransportSupervisor } from "../../src/transport/supervisor.js";
import { TransportClient } from "../../src/transport/client.js";
import { IinaFileRpcBridge } from "../../src/adapters/iina/provider-transport.js";

class FakeTransportClient implements TransportRpcClient {
  available = true;
  randomCalls = 0;
  requestCalls = 0;
  cancelCalls = 0;
  failRequestAfterDispatch = false;
  saveCalls: Array<{ owner: CredentialOwner; frame: CredentialEnvelope }> = [];
  shutdownCalls = 0;
  disposeCalls = 0;
  commitCalls: Array<{ commitId: string; expectedStoreRevision: number; profileState: unknown }> =
    [];
  failProfileCommit = false;
  profileSnapshot: ProfileStateStoreSnapshot = {
    initialized: true,
    storeRevision: 4,
    lastCommit: null,
    profileState: { profiles: [], activation: null },
    credentialConfigured: {},
  };

  async health(): Promise<void> {
    this.randomCalls += 1;
    if (!this.available)
      throw new SubTandemError("HELPER_UNAVAILABLE", "network", "RESTART_IINA", true);
  }

  async profileStateSave(
    owner: CredentialOwner,
    frame: CredentialEnvelope,
  ): Promise<ProfileStateCommitResult> {
    this.saveCalls.push({ owner, frame });
    if (!this.available)
      throw new SubTandemError("HELPER_UNAVAILABLE", "network", "RESTART_IINA", true);
    return { state: "committed", ...structuredClone(this.profileSnapshot) };
  }

  async profileStateRead(): Promise<ProfileStateStoreSnapshot> {
    return structuredClone(this.profileSnapshot);
  }

  async profileStateOpen(): Promise<ProfileStateCommitResult> {
    return { state: "committed", ...structuredClone(this.profileSnapshot) };
  }

  async profileStateInitialize(): Promise<ProfileStateCommitResult> {
    return { state: "committed", ...structuredClone(this.profileSnapshot) };
  }

  async profileStateCommit(
    commitId: string,
    expectedStoreRevision: number,
    profileState: unknown,
  ): Promise<ProfileStateCommitResult> {
    this.commitCalls.push({
      commitId,
      expectedStoreRevision,
      profileState: structuredClone(profileState),
    });
    if (this.failProfileCommit)
      throw new SubTandemError("HELPER_UNAVAILABLE", "network", "RESTART_IINA", true);
    return { state: "committed", ...structuredClone(this.profileSnapshot) };
  }

  async request(request: TransportRequest): Promise<TransportResponse> {
    this.requestCalls += 1;
    if (!this.available || this.failRequestAfterDispatch)
      throw new SubTandemError("HELPER_UNAVAILABLE", "network", "RESTART_IINA", true);
    return {
      jobId: request.jobId,
      transportState: "completed",
      statusCode: 200,
      headers: {},
      bodyText: "{}",
    };
  }

  async cancel(): Promise<"cancelled" | "already-completed" | "unknown"> {
    this.cancelCalls += 1;
    if (!this.available)
      throw new SubTandemError("HELPER_UNAVAILABLE", "network", "RESTART_IINA", true);
    return "cancelled";
  }

  async shutdown(): Promise<void> {
    this.shutdownCalls += 1;
  }

  dispose(): void {
    this.disposeCalls += 1;
  }
}

const providerRequest: TransportRequest = {
  credential: { source: "none" },
  owner: { senderId: "window", requestId: "request" },
  purpose: "test",
  provider: {
    kind: "openai",
    endpoint: "https://example.test/v1",
    model: "model",
    proxyMode: "system",
  },
  jobId: "7a90a4e6-cc4f-4f59-99b7-8ff522f887ae",
  method: "POST",
  url: "https://example.test/v1/chat/completions",
  headers: { "Content-Type": "application/json" },
  body: { input: "must-not-be-replayed" },
  timeoutMs: 30_000,
  maxResponseBytes: 1_024,
};

function delayedStart<T>(value: T): Promise<T> {
  return new Promise((resolve) => setTimeout(() => resolve(value), 0));
}

describe("transport supervisor", () => {
  it("claims a completed start before exposing its client to callers", async () => {
    const expired = new FakeTransportClient();
    const replacement = new FakeTransportClient();
    let starts = 0;
    const supervisor = new TransportSupervisor(() => {
      starts += 1;
      return starts === 1 ? delayedStart(expired) : Promise.resolve(replacement);
    });

    await supervisor.health();
    expired.available = false;
    await expect(supervisor.profileStateRead()).resolves.toMatchObject({ initialized: true });
    expect(starts).toBe(2);
    expect(expired.disposeCalls).toBe(1);
  });

  it("health-checks and replaces an expired helper before sending a provider request", async () => {
    const expired = new FakeTransportClient();
    const replacement = new FakeTransportClient();
    const clients = [expired, replacement];
    const supervisor = new TransportSupervisor(async () => clients.shift()!);

    await supervisor.health();
    expired.available = false;

    await expect(supervisor.request(providerRequest)).resolves.toMatchObject({ statusCode: 200 });
    expect(expired.requestCalls).toBe(0);
    expect(replacement.requestCalls).toBe(1);
  });

  it("commits through a real file RPC client after its generation directory disappears", async () => {
    const contents = new Map<string, string>();
    const directories = new Set<string>();
    const commits: Array<{ directory: string; body: unknown }> = [];
    let starts = 0;
    const supervisor = new TransportSupervisor(async () => {
      const directory = `/rpc/generation-${++starts}`;
      directories.add(directory);
      return new TransportClient(
        { port: 49152 + starts, token: `generation-token-${starts}` },
        new IinaFileRpcBridge(
          {
            exists: (path) => contents.has(path),
            read: (path) => contents.get(path) ?? null,
            delete: (path) => {
              contents.delete(path);
            },
            write: (path, value) => {
              if (!directories.has(directory)) throw new Error("Missing generation directory");
              contents.set(path, value);
              if (!path.endsWith(".request.ready")) return;
              const stem = path.slice(0, -".request.ready".length);
              const request = JSON.parse(contents.get(`${stem}.request.json`)!);
              let body: unknown = { state: "ok", protocolVersion: 2 };
              if (request.path === "/v2/profile-state") {
                commits.push({ directory, body: request.body });
                body = {
                  state: "committed",
                  initialized: true,
                  storeRevision: 5,
                  lastCommit: {
                    commitId: request.body.commitId,
                    operation: "commit",
                    baseRevision: 4,
                    requestDigest: "digest",
                  },
                  profileState: request.body.profileState,
                  credentialConfigured: {},
                };
              }
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
            },
          },
          {
            helper: "transport",
            fileDirectory: directory,
            maxRequestBytes: 65536,
            maxResponseBytes: 65536,
            maxConcurrentRequests: 8,
          },
        ),
      );
    });
    await supervisor.health();
    directories.delete("/rpc/generation-1");
    const commitId = "00000000-0000-4000-8000-000000000100";
    const profileState = { profiles: [], activation: null };
    const [result] = await Promise.all([
      supervisor.profileStateCommit(commitId, 4, profileState),
      supervisor.health(),
    ]);
    expect(result).toMatchObject({
      state: "committed",
      storeRevision: 5,
      lastCommit: { commitId },
    });
    expect(starts).toBe(2);
    expect(commits).toEqual([
      {
        directory: "/rpc/generation-2",
        body: { action: "commit", commitId, expectedStoreRevision: 4, profileState },
      },
    ]);
    expect(contents.size).toBe(0);
  });

  it("coalesces concurrent helper restart and health checks", async () => {
    const expired = new FakeTransportClient();
    const replacement = new FakeTransportClient();
    let starts = 0;
    const supervisor = new TransportSupervisor(async () => {
      starts += 1;
      return starts === 1 ? expired : replacement;
    });

    await supervisor.health();
    expired.available = false;
    await Promise.all([
      supervisor.request({ ...providerRequest, jobId: "0a90a4e6-cc4f-4f59-99b7-8ff522f887ae" }),
      supervisor.request({ ...providerRequest, jobId: "1a90a4e6-cc4f-4f59-99b7-8ff522f887ae" }),
    ]);

    expect(starts).toBe(2);
    expect(expired.requestCalls).toBe(0);
    expect(replacement.requestCalls).toBe(2);
  });

  it("retries a side-effect-free health check once on a newly unavailable helper", async () => {
    const failed = new FakeTransportClient();
    const replacement = new FakeTransportClient();
    let starts = 0;
    const supervisor = new TransportSupervisor(async () => {
      starts += 1;
      return starts === 1 ? failed : replacement;
    });

    const originalHealth = failed.health.bind(failed);
    failed.health = async () => {
      await originalHealth();
      failed.available = false;
    };

    await expect(supervisor.health()).resolves.toBeUndefined();
    expect(starts).toBe(2);
    expect(replacement.randomCalls).toBeGreaterThanOrEqual(2);
  });

  it("confirms an encrypted Save through the replacement helper without retrieving a secret", async () => {
    const expired = new FakeTransportClient();
    const replacement = new FakeTransportClient();
    let starts = 0;
    const supervisor = new TransportSupervisor(async () =>
      ++starts === 1 ? expired : replacement,
    );
    await supervisor.health();
    expired.available = false;
    const frame = encryptedSaveFrame({
      profiles: [
        {
          profileId: "10000000-0000-4000-8000-000000000001",
          revision: 1,
          displayName: "Synthetic",
          kind: "openai",
          endpoint: "https://example.test/v1",
          endpointFingerprint: "fingerprint",
          model: "model",
          proxyMode: "system",
        },
      ],
      activation: null,
    });
    await expect(supervisor.profileStateSave(encryptedSaveOwner, frame)).resolves.toMatchObject({
      state: "committed",
    });
    expect(replacement.saveCalls).toEqual([{ owner: encryptedSaveOwner, frame }]);
    expect(JSON.stringify(replacement.saveCalls)).not.toContain("synthetic-store-key");
    expect(supervisor).not.toHaveProperty("credentialRead");
    expect(supervisor).not.toHaveProperty("credentialWrite");
    expect(starts).toBe(2);
  });

  it("invalidates but never replays a provider POST that failed after dispatch", async () => {
    const failed = new FakeTransportClient();
    failed.failRequestAfterDispatch = true;
    const replacement = new FakeTransportClient();
    let starts = 0;
    const supervisor = new TransportSupervisor(async () => {
      starts += 1;
      return starts === 1 ? failed : replacement;
    });

    await expect(supervisor.request(providerRequest)).rejects.toMatchObject({
      code: "HELPER_UNAVAILABLE",
    });
    expect(failed.requestCalls).toBe(1);
    expect(replacement.requestCalls).toBe(0);
    expect(failed.shutdownCalls).toBe(0);
    expect(failed.disposeCalls).toBe(1);

    await expect(supervisor.request(providerRequest)).resolves.toMatchObject({ statusCode: 200 });
    expect(starts).toBe(2);
    expect(replacement.requestCalls).toBe(1);
  });

  it("replays one identical local Profile commit on a replacement helper only", async () => {
    const expired = new FakeTransportClient();
    expired.failProfileCommit = true;
    const replacement = new FakeTransportClient();
    replacement.profileSnapshot = {
      ...replacement.profileSnapshot,
      storeRevision: 5,
      lastCommit: {
        commitId: "00000000-0000-4000-8000-000000000101",
        operation: "commit",
        baseRevision: 4,
        requestDigest: "safe-digest",
      },
    };
    const clients = [expired, replacement];
    const supervisor = new TransportSupervisor(async () => clients.shift()!);
    await supervisor.health();
    const state = { profiles: [], activation: null };

    await expect(
      supervisor.profileStateCommit("00000000-0000-4000-8000-000000000101", 4, state),
    ).resolves.toMatchObject({ state: "committed", storeRevision: 5 });
    expect(expired.commitCalls).toEqual([
      {
        commitId: "00000000-0000-4000-8000-000000000101",
        expectedStoreRevision: 4,
        profileState: state,
      },
    ]);
    expect(replacement.commitCalls).toEqual(expired.commitCalls);
  });

  it("keeps an old read pending when a lost commit cannot be confirmed", async () => {
    const expired = new FakeTransportClient();
    expired.failProfileCommit = true;
    const replacement = new FakeTransportClient();
    replacement.failProfileCommit = true;
    const clients = [expired, replacement];
    const supervisor = new TransportSupervisor(async () => clients.shift()!);
    await supervisor.health();

    await expect(
      supervisor.profileStateCommit("00000000-0000-4000-8000-000000000102", 4, {
        profiles: [],
        activation: null,
      }),
    ).resolves.toMatchObject({ state: "reconciling", storeRevision: 4 });
    expect(expired.commitCalls).toHaveLength(1);
    expect(replacement.commitCalls).toHaveLength(1);
  });

  it("never infers durability from a matching receipt after two unconfirmed attempts", async () => {
    const client = new FakeTransportClient();
    client.profileSnapshot.lastCommit = {
      commitId: "00000000-0000-4000-8000-000000000103",
      operation: "commit",
      baseRevision: 3,
      requestDigest: "safe",
    };
    let attempts = 0;
    client.profileStateCommit = async () => {
      attempts += 1;
      throw new SubTandemError("PROFILE_STATE_UNCONFIRMED", "protocol", "RETRY");
    };
    const supervisor = new TransportSupervisor(async () => client);
    await expect(
      supervisor.profileStateCommit(client.profileSnapshot.lastCommit.commitId, 3, {
        profiles: [],
        activation: null,
      }),
    ).resolves.toMatchObject({ state: "reconciling", storeRevision: 4 });
    expect(attempts).toBe(2);
  });

  it("does not restart or leak a helper for a valid protocol rejection", async () => {
    const rejected = new FakeTransportClient();
    rejected.health = async () => {
      throw new SubTandemError("HELPER_PROTOCOL", "protocol", "RESTART_IINA");
    };
    let starts = 0;
    const supervisor = new TransportSupervisor(async () => {
      starts += 1;
      return rejected;
    });

    await expect(supervisor.request(providerRequest)).rejects.toMatchObject({
      code: "HELPER_PROTOCOL",
    });
    expect(starts).toBe(1);
    expect(rejected.shutdownCalls).toBe(0);
  });

  it("does not start a new helper solely to cancel work from an expired session", async () => {
    const expired = new FakeTransportClient();
    let starts = 0;
    const supervisor = new TransportSupervisor(async () => {
      starts += 1;
      return expired;
    });
    await supervisor.health();
    expired.available = false;

    await expect(supervisor.cancel("job-1")).resolves.toBe("unknown");
    expect(starts).toBe(1);
  });
});

it("blocks a provider send cancelled while its helper is starting", async () => {
  const { CompletionQueue } = await import("../helpers/profile-activation-harness.js");
  const { HelperProviderTransport } = await import("../../src/adapters/iina/provider-transport.js");
  const queue = new CompletionQueue<void, TransportRpcClient>();
  const client = new FakeTransportClient();
  const supervisor = new TransportSupervisor(() => queue.hold().promise);
  const adapter = new HelperProviderTransport(supervisor, () => providerRequest.jobId);
  const work = adapter.request(providerRequest).catch((error) => error);
  await queue.waitForPending();
  const cancellation = adapter.cancel(providerRequest.jobId);
  queue.releaseNext(client);
  await cancellation;
  expect(await work).toMatchObject({ category: "cancelled" });
  expect(client.requestCalls).toBe(0);
});
