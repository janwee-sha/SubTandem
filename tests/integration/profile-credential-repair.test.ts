import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { nativeGlobalLifecycle } from "../helpers/native-global-lifecycle.js";

afterEach(() => vi.unstubAllGlobals());

describe("native credential failure repair", () => {
  it("keeps a failed read unchanged and explicitly clears only its target", async () => {
    const h = await nativeGlobalLifecycle();
    try {
      const input = {
        kind: "openai" as const,
        displayName: "Target",
        endpoint: "https://example.test/v1",
        model: "model",
        proxyMode: "direct" as const,
      };
      await h.global.save(input, "");
      await h.global.save({ ...input, displayName: "Other" }, "");
      const profiles = await h.global.profiles();
      const target = profiles.find((profile: any) => profile.displayName === "Target");
      const other = profiles.find((profile: any) => profile.displayName === "Other");
      const snapshot = h.snapshot();
      const damaged = {
        credentialId: "10000000-0000-4000-8000-000000000099",
        envelope: "damaged-authenticated-ciphertext",
      };
      snapshot.credentials = { [target.profileId]: damaged, [other.profileId]: damaged };
      writeFileSync(join(h.directory, "credentials.json"), JSON.stringify(snapshot));
      await h.restart();
      const visible = await h.global.profiles();
      expect(visible).toHaveLength(2);
      const current = visible.find((profile: any) => profile.profileId === target.profileId);
      expect(current.credentialConfigured).toBe(true);
      const before = h.bytes();
      await expect(h.global.readCredential(current)).rejects.toThrow();
      expect(h.bytes()).toEqual(before);
      await h.global.save(
        { ...input, profileId: current.profileId, expectedRevision: current.revision },
        "",
      );
      expect(h.snapshot().credentials).toEqual({ [other.profileId]: damaged });
      expect(
        (await h.global.profiles()).find((profile: any) => profile.profileId === other.profileId)
          .revision,
      ).toBe(other.revision);
    } finally {
      await h.close();
    }
  }, 20_000);
  it("fails safely when another record could contain legacy plaintext", async () => {
    const h = await nativeGlobalLifecycle();
    try {
      const input = {
        kind: "openai" as const,
        displayName: "Target",
        endpoint: "https://example.test/v1",
        model: "model",
        proxyMode: "direct" as const,
      };
      await h.global.save(input, "");
      await h.global.save({ ...input, displayName: "Other" }, "");
      const profiles = await h.global.profiles();
      const [target, other] = profiles;
      const snapshot = h.snapshot();
      snapshot.credentials = { [other.profileId]: { apiKey: "unsafe-legacy-value" } };
      writeFileSync(join(h.directory, "credentials.json"), JSON.stringify(snapshot));
      await h.restart();
      expect(await h.global.profiles()).toHaveLength(2);
      const before = h.bytes();
      await expect(
        h.global.save(
          { ...input, profileId: target.profileId, expectedRevision: target.revision },
          "",
        ),
      ).rejects.toThrow();
      expect(h.bytes()).toEqual(before);
    } finally {
      await h.close();
    }
  }, 20_000);
});
