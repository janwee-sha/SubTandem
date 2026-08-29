import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { HelperCredentialStore, CredentialStoreError } from "../../src/credentials/store.js";
import { SubTandemError } from "../../src/domain/errors.js";
import type { TransportRpcClient } from "../../src/transport/client.js";

const firstProfile = "7a90a4e6-cc4f-4f59-99b7-8ff522f887ae";
const secondProfile = "8a90a4e6-cc4f-4f59-99b7-8ff522f887ae";

class MemoryCredentialTransport {
  readonly values = new Map<string, Record<string, string>>();
  fail = false;
  helperUnavailable = false;

  private assertAvailable(): void {
    if (this.helperUnavailable)
      throw new SubTandemError("HELPER_UNAVAILABLE", "network", "RESTART_IINA", true);
    if (this.fail) throw new Error("private transport detail");
  }

  async credentialRead(profileId: string): Promise<Record<string, string> | null> {
    this.assertAvailable();
    const fields = this.values.get(profileId);
    return fields ? { ...fields } : null;
  }

  async credentialWrite(profileId: string, fields: Record<string, string>): Promise<void> {
    this.assertAvailable();
    this.values.set(profileId, { ...fields });
  }

  async credentialDelete(profileId: string): Promise<void> {
    this.assertAvailable();
    this.values.delete(profileId);
  }
}

describe("plugin-private credential store", () => {
  it("replaces, retains and deletes a Claude key through the one-way helper boundary", async () => {
    const transport = new MemoryCredentialTransport();
    const store = new HelperCredentialStore(transport as unknown as TransportRpcClient);
    await store.setSecret(firstProfile, { apiKey: "claude-key-one" });
    await store.setSecret(firstProfile, { apiKey: "claude-key-two" });
    await expect(store.getSecret(firstProfile)).resolves.toEqual({ apiKey: "claude-key-two" });
    expect(transport.values.get(firstProfile)).toEqual({ apiKey: "claude-key-two" });
    await store.deleteSecret(firstProfile);
    await expect(store.getSecret(firstProfile)).resolves.toBeNull();

    const nativeSource = readFileSync(
      new URL(
        "../../native/transport/Sources/SubTandemTransport/SecureCredentialStore.swift",
        import.meta.url,
      ),
      "utf8",
    );
    expect(nativeSource).toContain("fchmod(descriptor, 0o600)");
  });

  it("round-trips one write-only API key without returning mutable references", async () => {
    const transport = new MemoryCredentialTransport();
    const store = new HelperCredentialStore(transport as unknown as TransportRpcClient);

    await store.setSecret(firstProfile, { apiKey: "private-key" });
    const loaded = await store.getSecret(firstProfile);
    expect(loaded).toEqual({ apiKey: "private-key" });
    loaded!.apiKey = "mutated";
    await expect(store.getSecret(firstProfile)).resolves.toEqual({ apiKey: "private-key" });
  });

  it("deletes one profile credential without changing another", async () => {
    const transport = new MemoryCredentialTransport();
    const store = new HelperCredentialStore(transport as unknown as TransportRpcClient);
    await store.setSecret(firstProfile, { apiKey: "first" });
    await store.setSecret(secondProfile, { apiKey: "second" });

    await store.deleteSecret(firstProfile);

    await expect(store.getSecret(firstProfile)).resolves.toBeNull();
    await expect(store.getSecret(secondProfile)).resolves.toEqual({ apiKey: "second" });
    await expect(store.deleteSecret(firstProfile)).resolves.toBeUndefined();
  });

  it("rejects unsupported fields, empty values and invalid profile IDs before persistence", async () => {
    const store = new HelperCredentialStore(
      new MemoryCredentialTransport() as unknown as TransportRpcClient,
    );

    await expect(store.setSecret("not-a-uuid", { apiKey: "private-key" })).rejects.toBeInstanceOf(
      CredentialStoreError,
    );
    await expect(store.setSecret(firstProfile, { apiKey: "" })).rejects.toBeInstanceOf(
      CredentialStoreError,
    );
    await expect(store.setSecret(firstProfile, { password: "private" })).rejects.toBeInstanceOf(
      CredentialStoreError,
    );
  });

  it("returns a stable safe storage error without exposing transport details", async () => {
    const transport = new MemoryCredentialTransport();
    transport.fail = true;
    const store = new HelperCredentialStore(transport as unknown as TransportRpcClient);

    await expect(store.setSecret(firstProfile, { apiKey: "private-key" })).rejects.toMatchObject({
      code: "CREDENTIAL_STORE_UNAVAILABLE",
    });
    await expect(store.setSecret(firstProfile, { apiKey: "private-key" })).rejects.not.toThrow(
      /private transport detail|private-key/,
    );
  });

  it("preserves expired-helper classification so the UI does not blame the credential file", async () => {
    const transport = new MemoryCredentialTransport();
    transport.helperUnavailable = true;
    const store = new HelperCredentialStore(transport as unknown as TransportRpcClient);

    await expect(store.getSecret(firstProfile)).rejects.toMatchObject({
      code: "HELPER_UNAVAILABLE",
      category: "network",
      userAction: "RESTART_IINA",
    });
  });
});
