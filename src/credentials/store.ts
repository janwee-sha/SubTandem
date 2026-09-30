import type { TransportRpcClient } from "../transport/client.js";
import type { ProfileStateCommitResult, ProfileStateStoreSnapshot } from "../transport/client.js";
import type { PersistentProviderProfile, ProfileState } from "../domain/types.js";
import { SubTandemError } from "../domain/errors.js";
import type { CredentialEnvelope, CredentialOwner } from "../../shared/credential-protocol.js";

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export class CredentialStoreError extends Error {
  constructor(readonly code: "INVALID_CREDENTIAL" | "CREDENTIAL_STORE_UNAVAILABLE") {
    super(code);
    this.name = "CredentialStoreError";
  }
}

export class HelperProfileStateStore {
  constructor(private readonly transport: TransportRpcClient) {}

  save(owner: CredentialOwner, frame: CredentialEnvelope): Promise<ProfileStateCommitResult> {
    return this.mutation(() => {
      if (!this.transport.profileStateSave)
        throw new CredentialStoreError("CREDENTIAL_STORE_UNAVAILABLE");
      return this.transport.profileStateSave(owner, frame);
    });
  }

  async read(): Promise<ProfileStateStoreSnapshot> {
    try {
      return cloneJson(await this.transport.profileStateRead());
    } catch (error) {
      if (error instanceof SubTandemError) throw error;
      throw new CredentialStoreError("CREDENTIAL_STORE_UNAVAILABLE");
    }
  }

  open(commitId: string): Promise<ProfileStateCommitResult> {
    return this.mutation(() => this.transport.profileStateOpen(commitId));
  }

  migrate(commitId: string, profiles?: PersistentProviderProfile[]): Promise<ProfileStateCommitResult> {
    return this.mutation(() => {
      if (!this.transport.profileStateMigrate) throw new CredentialStoreError("CREDENTIAL_STORE_UNAVAILABLE");
      return this.transport.profileStateMigrate(commitId, profiles);
    });
  }

  cleanup(commitId: string, migrationId: string, preferenceConfirmed: boolean): Promise<ProfileStateCommitResult> {
    return this.mutation(() => {
      if (!this.transport.profileStateCleanup) throw new CredentialStoreError("CREDENTIAL_STORE_UNAVAILABLE");
      return this.transport.profileStateCleanup(commitId, migrationId, preferenceConfirmed);
    });
  }

  initialize(
    commitId: string,
    expectedStoreRevision: number,
    profiles: PersistentProviderProfile[],
  ): Promise<ProfileStateCommitResult> {
    return this.mutation(() =>
      this.transport.profileStateInitialize(commitId, expectedStoreRevision, profiles),
    );
  }

  commit(
    commitId: string,
    expectedStoreRevision: number,
    profileState: ProfileState,
  ): Promise<ProfileStateCommitResult> {
    return this.mutation(() =>
      this.transport.profileStateCommit(commitId, expectedStoreRevision, profileState),
    );
  }

  private async mutation(
    operation: () => Promise<ProfileStateCommitResult>,
  ): Promise<ProfileStateCommitResult> {
    try {
      return cloneJson(await operation());
    } catch (error) {
      if (error instanceof SubTandemError) throw error;
      throw new CredentialStoreError("CREDENTIAL_STORE_UNAVAILABLE");
    }
  }
}
