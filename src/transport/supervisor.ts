import { SubTandemError } from "../domain/errors.js";
import type {
  ProfileStateCommitResult,
  ProfileStateStoreSnapshot,
  TransportRequest,
  TransportResponse,
  TransportRpcClient,
} from "./client.js";
import type { PersistentProviderProfile, ProfileState } from "../domain/types.js";

function isExpiredSession(error: unknown): boolean {
  return error instanceof SubTandemError && error.code === "HELPER_UNAVAILABLE";
}

export class TransportSupervisor implements TransportRpcClient {
  private client: TransportRpcClient | null = null;
  private starting: Promise<TransportRpcClient> | null = null;
  private checking: Promise<TransportRpcClient> | null = null;

  constructor(private readonly start: () => Promise<TransportRpcClient>) {}

  private async currentOrStart(): Promise<TransportRpcClient> {
    if (this.client) return this.client;
    if (!this.starting) this.starting = this.start();
    const starting = this.starting;
    try {
      const client = await starting;
      if (this.starting === starting) {
        this.client = client;
        this.starting = null;
      }
      return client;
    } catch (error) {
      if (this.starting === starting) this.starting = null;
      throw error;
    }
  }

  private retireExpiredClient(client: TransportRpcClient): void {
    if (this.client !== client) return;
    this.client = null;
    client.dispose?.();
  }

  private async liveClient(): Promise<TransportRpcClient> {
    if (this.checking) return this.checking;
    const checking = (async () => {
      let client = await this.currentOrStart();
      try {
        await client.health();
        return client;
      } catch (error) {
        if (!isExpiredSession(error)) throw error;
        this.retireExpiredClient(client);
      }

      client = await this.currentOrStart();
      try {
        await client.health();
        return client;
      } catch (error) {
        this.retireExpiredClient(client);
        throw error;
      }
    })();
    this.checking = checking;
    try {
      return await checking;
    } finally {
      if (this.checking === checking) this.checking = null;
    }
  }

  async health(): Promise<void> {
    let client = await this.liveClient();
    try {
      return await client.health();
    } catch (error) {
      if (!isExpiredSession(error)) throw error;
      this.retireExpiredClient(client);
    }
    client = await this.liveClient();
    await client.health();
  }

  async credentialRead(profileId: string): Promise<Record<string, string> | null> {
    let client = await this.liveClient();
    try {
      return await client.credentialRead(profileId);
    } catch (error) {
      if (!isExpiredSession(error)) throw error;
      this.retireExpiredClient(client);
    }
    client = await this.liveClient();
    return client.credentialRead(profileId);
  }

  async credentialWrite(
    profileId: string,
    fields: Record<string, string>,
    commitId: string,
    expectedStoreRevision: number,
    expectedProfileRevision: number,
  ): Promise<ProfileStateCommitResult> {
    return this.localMutation(commitId, (client) =>
      client.credentialWrite(
        profileId,
        fields,
        commitId,
        expectedStoreRevision,
        expectedProfileRevision,
      ),
    );
  }

  async profileStateRead(): Promise<ProfileStateStoreSnapshot> {
    let client = await this.liveClient();
    try {
      return await client.profileStateRead();
    } catch (error) {
      if (!isExpiredSession(error)) throw error;
      this.retireExpiredClient(client);
    }
    client = await this.liveClient();
    return client.profileStateRead();
  }

  profileStateOpen(commitId: string): Promise<ProfileStateCommitResult> {
    return this.localMutation(commitId, (client) => client.profileStateOpen(commitId));
  }

  profileStateInitialize(
    commitId: string,
    expectedStoreRevision: number,
    profiles: PersistentProviderProfile[],
  ): Promise<ProfileStateCommitResult> {
    return this.localMutation(commitId, (client) =>
      client.profileStateInitialize(commitId, expectedStoreRevision, profiles),
    );
  }

  profileStateCommit(
    commitId: string,
    expectedStoreRevision: number,
    profileState: ProfileState,
  ): Promise<ProfileStateCommitResult> {
    return this.localMutation(commitId, (client) =>
      client.profileStateCommit(commitId, expectedStoreRevision, profileState),
    );
  }

  async request(request: TransportRequest, assertActive?: () => void): Promise<TransportResponse> {
    assertActive?.();
    const client = await this.liveClient();
    assertActive?.();
    try {
      const response = await client.request(request, assertActive);
      assertActive?.();
      return response;
    } catch (error) {
      if (isExpiredSession(error)) this.retireExpiredClient(client);
      throw error;
    }
  }

  async cancel(jobId: string): Promise<"cancelled" | "already-completed" | "unknown"> {
    let client = this.client;
    if (!client && this.starting) {
      try {
        client = await this.starting;
      } catch {
        return "unknown";
      }
    }
    if (!client) return "unknown";
    try {
      return await client.cancel(jobId);
    } catch (error) {
      if (!isExpiredSession(error)) throw error;
      this.retireExpiredClient(client);
      return "unknown";
    }
  }

  async shutdown(): Promise<void> {
    const client = this.client;
    this.client = null;
    this.checking = null;
    if (!client) return;
    try {
      await client.shutdown();
    } catch (error) {
      if (!isExpiredSession(error)) throw error;
    }
  }

  private async localMutation(
    commitId: string,
    attempt: (client: TransportRpcClient) => Promise<ProfileStateCommitResult>,
  ): Promise<ProfileStateCommitResult> {
    let client = await this.liveClient();
    try {
      return await attempt(client);
    } catch (error) {
      if (!isExpiredSession(error)) throw error;
      this.retireExpiredClient(client);
    }
    client = await this.liveClient();
    try {
      return await attempt(client);
    } catch {
      try {
        const snapshot = await client.profileStateRead();
        return {
          state: snapshot.lastCommit?.commitId === commitId ? "committed" : "reconciling",
          ...snapshot,
        };
      } catch (error) {
        if (isExpiredSession(error)) this.retireExpiredClient(client);
        throw error;
      }
    }
  }
}
