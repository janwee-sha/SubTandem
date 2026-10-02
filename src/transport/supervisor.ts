import { assertProfileDeadline, withinProfileDeadline } from "./deadline.js";
import type { CredentialEnvelope, CredentialOwner } from "../../shared/credential-protocol.js";
import { validateProfileSave } from "./client.js";
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

  private async currentOrStart(deadlineMs = Date.now() + 15_000): Promise<TransportRpcClient> {
    assertProfileDeadline(deadlineMs);
    if (this.client) return this.client;
    if (!this.starting) {
      const starting = this.start().then((client) => {
        if (this.starting !== starting || Date.now() >= deadlineMs) {
          client.dispose?.();
          throw new SubTandemError("HELPER_UNAVAILABLE", "network", "RESTART_IINA");
        }
        this.client = client;
        return client;
      });
      this.starting = starting;
    }
    const starting = this.starting;
    try {
      return await withinProfileDeadline(starting, deadlineMs);
    } finally {
      if (this.starting === starting) this.starting = null;
    }
  }

  private retireExpiredClient(client: TransportRpcClient): void {
    if (this.client !== client) return;
    this.client = null;
    client.dispose?.();
  }

  private async liveClient(deadlineMs = Date.now() + 15_000): Promise<TransportRpcClient> {
    if (this.checking) return withinProfileDeadline(this.checking, deadlineMs);
    let ownedClient: TransportRpcClient | null = null;
    const checking = Promise.resolve().then(async () => {
      for (let attempt = 0; attempt < 2; attempt++) {
        const client = await this.currentOrStart(deadlineMs);
        ownedClient = client;
        try {
          await withinProfileDeadline(client.health(), deadlineMs);
          assertProfileDeadline(deadlineMs);
          if (this.checking !== checking)
            throw new SubTandemError("HELPER_UNAVAILABLE", "network", "RESTART_IINA");
          return client;
        } catch (error) {
          if (!isExpiredSession(error)) throw error;
          this.retireExpiredClient(client);
          if (attempt === 1) throw error;
          assertProfileDeadline(deadlineMs);
        }
      }
      throw new SubTandemError("HELPER_UNAVAILABLE", "network", "RESTART_IINA");
    });
    this.checking = checking;
    try {
      return await withinProfileDeadline(checking, deadlineMs);
    } catch (error) {
      if (isExpiredSession(error) && ownedClient) this.retireExpiredClient(ownedClient);
      throw error;
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

  async credentialChannel(action: string, payload: unknown): Promise<unknown> {
    return this.channelOperation((client) => {
      if (!client.credentialChannel)
        throw new SubTandemError("HELPER_PROTOCOL", "protocol", "RESTART_IINA");
      return client.credentialChannel(action, payload);
    }, action === "open");
  }

  async draftOperation(action: string, payload: unknown): Promise<unknown> {
    return this.channelOperation((client) => {
      if (!client.draftOperation)
        throw new SubTandemError("HELPER_PROTOCOL", "protocol", "RESTART_IINA");
      return client.draftOperation(action, payload);
    });
  }

  private async channelOperation(
    attempt: (client: TransportRpcClient) => Promise<unknown>,
    reopen = false,
  ): Promise<unknown> {
    const client = await this.currentOrStart();
    try {
      return await attempt(client);
    } catch (error) {
      if (!isExpiredSession(error)) throw error;
      this.retireExpiredClient(client);
      if (!reopen) throw error;
    }
    const replacement = await this.currentOrStart();
    try {
      return await attempt(replacement);
    } catch (error) {
      if (isExpiredSession(error)) this.retireExpiredClient(replacement);
      throw error;
    }
  }

  async profileStateSave(
    owner: CredentialOwner,
    frame: CredentialEnvelope,
  ): Promise<ProfileStateCommitResult> {
    validateProfileSave(owner, frame);
    let client = await this.liveClient();
    const attempt = () => {
      if (!client.profileStateSave)
        throw new SubTandemError("HELPER_PROTOCOL", "protocol", "RESTART_IINA");
      return client.profileStateSave(owner, frame);
    };
    try {
      return await attempt();
    } catch (error) {
      if (
        !isExpiredSession(error) &&
        !(error instanceof SubTandemError && error.code === "PROFILE_STATE_UNCONFIRMED")
      )
        throw error;
      if (isExpiredSession(error)) {
        this.retireExpiredClient(client);
        client = await this.liveClient();
      }
    }
    try {
      return await attempt();
    } catch {
      return { state: "reconciling", ...(await client.profileStateRead()) };
    }
  }

  async profileStateRead(deadlineMs = Date.now() + 15_000): Promise<ProfileStateStoreSnapshot> {
    let client = await this.liveClient(deadlineMs);
    try {
      return await withinProfileDeadline(client.profileStateRead(deadlineMs), deadlineMs);
    } catch (error) {
      if (!isExpiredSession(error)) throw error;
      this.retireExpiredClient(client);
    }
    client = await this.liveClient(deadlineMs);
    return withinProfileDeadline(client.profileStateRead(deadlineMs), deadlineMs);
  }

  async profileStateRecover(
    commitId: string,
    expiresAtMs: number,
  ): Promise<ProfileStateCommitResult> {
    const client = await this.liveClient(expiresAtMs);
    if (!client.profileStateRecover)
      throw new SubTandemError("HELPER_PROTOCOL", "protocol", "RESTART_IINA");
    try {
      return await withinProfileDeadline(
        client.profileStateRecover(commitId, expiresAtMs),
        expiresAtMs,
      );
    } catch (error) {
      if (!(error instanceof SubTandemError) || error.code !== "PROFILE_STATE_UNCONFIRMED")
        throw error;
      const snapshot = await this.profileStateRead(expiresAtMs);
      return { state: "reconciling", ...snapshot };
    }
  }

  profileStateOpen(commitId: string): Promise<ProfileStateCommitResult> {
    return this.localMutation((client) => client.profileStateOpen(commitId));
  }

  profileStateMigrate(
    commitId: string,
    profiles?: PersistentProviderProfile[],
  ): Promise<ProfileStateCommitResult> {
    return this.localMutation((client) => {
      if (!client.profileStateMigrate) throw new Error("MIGRATION_UNAVAILABLE");
      return client.profileStateMigrate(commitId, profiles);
    });
  }

  profileStateCleanup(
    commitId: string,
    migrationId: string,
    preferenceConfirmed: boolean,
  ): Promise<ProfileStateCommitResult> {
    return this.localMutation((client) => {
      if (!client.profileStateCleanup) throw new Error("MIGRATION_UNAVAILABLE");
      return client.profileStateCleanup(commitId, migrationId, preferenceConfirmed);
    });
  }

  profileStateInitialize(
    commitId: string,
    expectedStoreRevision: number,
    profiles: PersistentProviderProfile[],
  ): Promise<ProfileStateCommitResult> {
    return this.localMutation((client) =>
      client.profileStateInitialize(commitId, expectedStoreRevision, profiles),
    );
  }

  profileStateCommit(
    commitId: string,
    expectedStoreRevision: number,
    profileState: ProfileState,
  ): Promise<ProfileStateCommitResult> {
    return this.localMutation((client) =>
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
    this.starting = null;
    this.checking = null;
    if (!client) return;
    try {
      await client.shutdown();
    } catch (error) {
      if (!isExpiredSession(error)) throw error;
    }
  }

  private async localMutation(
    attempt: (client: TransportRpcClient) => Promise<ProfileStateCommitResult>,
  ): Promise<ProfileStateCommitResult> {
    let client = await this.liveClient();
    try {
      return await attempt(client);
    } catch (error) {
      if (
        !isExpiredSession(error) &&
        !(error instanceof SubTandemError && error.code === "PROFILE_STATE_UNCONFIRMED")
      )
        throw error;
      if (isExpiredSession(error)) {
        this.retireExpiredClient(client);
        client = await this.liveClient();
      }
    }
    try {
      return await attempt(client);
    } catch {
      try {
        const snapshot = await client.profileStateRead();
        return {
          state: "reconciling",
          ...snapshot,
        };
      } catch (error) {
        if (isExpiredSession(error)) this.retireExpiredClient(client);
        throw error;
      }
    }
  }
}
