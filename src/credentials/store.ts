import type { TransportRpcClient } from "../transport/client.js";
import type { ProfileStateCommitResult, ProfileStateStoreSnapshot } from "../transport/client.js";
import type { PersistentProviderProfile, ProfileState } from "../domain/types.js";
import { SubTandemError } from "../domain/errors.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export class CredentialStoreError extends Error {
  constructor(readonly code: "INVALID_CREDENTIAL" | "CREDENTIAL_STORE_UNAVAILABLE") {
    super(code);
    this.name = "CredentialStoreError";
  }
}

function validateProfileId(profileId: string): void {
  if (!UUID.test(profileId)) throw new CredentialStoreError("INVALID_CREDENTIAL");
}

function validatedFields(fields: Record<string, string>): Record<string, string> {
  const names = Object.keys(fields);
  if (
    names.length !== 1 ||
    names[0] !== "apiKey" ||
    typeof fields.apiKey !== "string" ||
    !fields.apiKey.trim() ||
    fields.apiKey.length > 8_192
  ) {
    throw new CredentialStoreError("INVALID_CREDENTIAL");
  }
  return { apiKey: fields.apiKey };
}

export class HelperCredentialStore {
  constructor(private readonly transport: TransportRpcClient) {}

  async getSecret(profileId: string): Promise<Record<string, string> | null> {
    validateProfileId(profileId);
    try {
      const fields = await this.transport.credentialRead(profileId);
      return fields ? validatedFields(fields) : null;
    } catch (error) {
      if (error instanceof CredentialStoreError) throw error;
      if (error instanceof SubTandemError) throw error;
      throw new CredentialStoreError("CREDENTIAL_STORE_UNAVAILABLE");
    }
  }

  async setSecret(
    profileId: string,
    fields: Record<string, string>,
    options: {
      commitId: string;
      expectedStoreRevision: number;
      expectedProfileRevision: number;
    },
  ): Promise<ProfileStateCommitResult> {
    validateProfileId(profileId);
    const validated = validatedFields(fields);
    try {
      return await this.transport.credentialWrite(
        profileId,
        validated,
        options.commitId,
        options.expectedStoreRevision,
        options.expectedProfileRevision,
      );
    } catch (error) {
      if (error instanceof SubTandemError) throw error;
      throw new CredentialStoreError("CREDENTIAL_STORE_UNAVAILABLE");
    }
  }
}

export class HelperProfileStateStore {
  constructor(private readonly transport: TransportRpcClient) {}

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
