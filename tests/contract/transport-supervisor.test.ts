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

class FakeTransportClient implements TransportRpcClient {
  available = true;
  randomCalls = 0;
  requestCalls = 0;
  cancelCalls = 0;
  failRequestAfterDispatch = false;
  credentials = new Map<string, Record<string, string>>();
  shutdownCalls = 0;
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

  async credentialRead(profileId: string): Promise<Record<string, string> | null> {
    if (!this.available)
      throw new SubTandemError("HELPER_UNAVAILABLE", "network", "RESTART_IINA", true);
    const fields = this.credentials.get(profileId);
    return fields ? { ...fields } : null;
  }

  async credentialWrite(
    profileId: string,
    fields: Record<string, string>,
  ): Promise<ProfileStateCommitResult> {
    if (!this.available)
      throw new SubTandemError("HELPER_UNAVAILABLE", "network", "RESTART_IINA", true);
    this.credentials.set(profileId, { ...fields });
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
}

const providerRequest: TransportRequest = {
  jobId: "7a90a4e6-cc4f-4f59-99b7-8ff522f887ae",
  method: "POST",
  url: "https://example.test/v1/chat/completions",
  headers: { "Content-Type": "application/json" },
  body: { input: "must-not-be-replayed" },
  timeoutMs: 30_000,
  maxResponseBytes: 1_024,
};

describe("transport supervisor", () => {
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

  it("reconnects fixed-purpose credential reads and idempotent writes", async () => {
    const expired = new FakeTransportClient();
    const replacement = new FakeTransportClient();
    let starts = 0;
    const supervisor = new TransportSupervisor(async () => {
      starts += 1;
      return starts === 1 ? expired : replacement;
    });
    await supervisor.health();
    expired.available = false;
    const profileId = "7a90a4e6-cc4f-4f59-99b7-8ff522f887ae";

    await expect(
      supervisor.credentialWrite(
        profileId,
        { apiKey: "private-key" },
        "00000000-0000-4000-8000-000000000100",
        4,
        1,
      ),
    ).resolves.toMatchObject({ state: "committed" });
    await expect(supervisor.credentialRead(profileId)).resolves.toEqual({ apiKey: "private-key" });
    expect(replacement.credentials.get(profileId)).toEqual({ apiKey: "private-key" });
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
    expect(failed.shutdownCalls).toBe(1);

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
