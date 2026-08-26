import type { TransportRpcClient } from "../transport/client.js";
import { SubTandemError } from "../domain/errors.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

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

/**
 * Credentials are persisted by the authenticated native helper in one fixed
 * plugin-private file. The helper owns atomic writes and POSIX mode 0600;
 * this facade keeps validation and safe error classification in Global.
 */
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

  async setSecret(profileId: string, fields: Record<string, string>): Promise<void> {
    validateProfileId(profileId);
    const validated = validatedFields(fields);
    try {
      await this.transport.credentialWrite(profileId, validated);
    } catch (error) {
      if (error instanceof SubTandemError) throw error;
      throw new CredentialStoreError("CREDENTIAL_STORE_UNAVAILABLE");
    }
  }

  async deleteSecret(profileId: string): Promise<void> {
    validateProfileId(profileId);
    try {
      await this.transport.credentialDelete(profileId);
    } catch (error) {
      if (error instanceof SubTandemError) throw error;
      throw new CredentialStoreError("CREDENTIAL_STORE_UNAVAILABLE");
    }
  }
}
