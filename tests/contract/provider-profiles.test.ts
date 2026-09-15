import { describe, expect, it } from "vitest";
import { sanitizedProfileView } from "../../src/domain/messages.js";
import { normalizeProviderEndpoint, ProviderProfiles } from "../../src/providers/profiles.js";

describe("latest provider Profiles", () => {
  it("normalizes and revises only the latest Profile", () => {
    const profiles = new ProviderProfiles(() => "profile-a");
    const first = profiles.save({
      displayName: "Claude",
      kind: "claude",
      endpoint: "https://API.Anthropic.com/",
      model: " exact-model ",
    });
    const latest = profiles.save({
      profileId: first.profileId,
      expectedRevision: 1,
      displayName: "OpenAI",
      kind: "openai",
      endpoint: "https://api.example/v1",
      model: "model-a",
      proxyMode: "direct",
    });

    expect(first).toMatchObject({ revision: 1, endpoint: "https://api.anthropic.com" });
    expect(latest).toMatchObject({ revision: 2, proxyMode: "direct" });
    expect(latest.endpointFingerprint).not.toBe(first.endpointFingerprint);
    expect(profiles.get(first.profileId, 1)).toBeNull();
    expect(profiles.get(first.profileId, 2)).toEqual(latest);
    expect(profiles.listLatest()).toEqual([latest]);
  });

  it("hydrates exact latest revisions without incrementing or retaining history", () => {
    const source = new ProviderProfiles(() => "profile-a");
    const latest = source.save({
      displayName: "A",
      kind: "openai",
      endpoint: "https://a.example/v1",
      model: "model-a",
    });
    const restored = new ProviderProfiles(() => "unused");

    restored.hydrate([latest]);

    expect(restored.listLatest()).toEqual([latest]);
    expect(restored.get(latest.profileId, latest.revision)).toEqual(latest);
    expect(restored).not.toHaveProperty("select");
    expect(restored).not.toHaveProperty("lease");
    expect(restored).not.toHaveProperty("release");
  });

  it("builds and commits a validated candidate only after persistence succeeds", () => {
    const profiles = new ProviderProfiles(() => "profile-a");
    const candidate = profiles.createSaveCandidate({
      displayName: "A",
      kind: "openai",
      endpoint: "https://a.example/v1",
      model: "model-a",
    });

    expect(profiles.listLatest()).toEqual([]);
    profiles.commitCandidate(candidate);
    expect(profiles.listLatest()).toEqual([candidate]);
    expect(() => profiles.commitCandidate(candidate)).toThrow(/STALE_PROFILE_REVISION/);
  });

  it("rejects duplicate hydration identities, forged fingerprints and generated collisions", () => {
    const profiles = new ProviderProfiles(() => "profile-a");
    const saved = profiles.save({
      displayName: "A",
      kind: "openai",
      endpoint: "https://a.example/v1",
      model: "model-a",
    });
    expect(() => profiles.hydrate([saved, saved])).toThrow(/DUPLICATE_PROFILE/);
    expect(() => profiles.hydrate([{ ...saved, endpointFingerprint: "forged" }])).toThrow(
      /PROFILE_FINGERPRINT_MISMATCH/,
    );
    expect(() =>
      profiles.createSaveCandidate({
        displayName: "collision",
        kind: "openai",
        endpoint: "https://collision.example/v1",
        model: "model",
      }),
    ).toThrow(/PROFILE_ID_COLLISION/);
  });

  it("keeps failed candidates from changing the latest revision", () => {
    const profiles = new ProviderProfiles(() => "profile-a");
    const saved = profiles.save({
      displayName: "A",
      kind: "openai",
      endpoint: "https://a.example/v1",
      model: "model-a",
    });
    expect(() =>
      profiles.createSaveCandidate({
        profileId: saved.profileId,
        expectedRevision: 0,
        displayName: "stale",
        kind: "openai",
        endpoint: "https://stale.example/v1",
        model: "model",
      }),
    ).toThrow(/STALE_PROFILE_REVISION/);
    expect(profiles.listLatest()).toEqual([saved]);
  });

  it("deletes only the exact latest revision", () => {
    const profiles = new ProviderProfiles(() => "profile-a");
    const saved = profiles.save({
      displayName: "A",
      kind: "ollama",
      endpoint: "http://127.0.0.1:11434",
      model: "qwen",
    });
    expect(() => profiles.delete(saved.profileId, 2)).toThrow(/STALE_PROFILE_REVISION/);
    expect(profiles.delete(saved.profileId, 1)).toEqual(saved);
    expect(profiles.listLatest()).toEqual([]);
  });

  it("publishes configured state without readable credentials", () => {
    const view = sanitizedProfileView({
      profileId: "profile-a",
      revision: 3,
      displayName: "A",
      kind: "claude",
      endpoint: "https://api.anthropic.com",
      endpointFingerprint: "fingerprint",
      model: "model",
      credential: { apiKey: "private-key" },
    });
    expect(view.credentialConfigured).toBe(true);
    expect(JSON.stringify(view)).not.toMatch(/private-key|apiKey/);
  });

  it.each([
    ["openai", "https://api.example.test/v1", "https://api.example.test/v1"],
    ["openai", "http://127.0.0.1:8080/v1", "http://127.0.0.1:8080/v1"],
    ["ollama", "https://ollama.example.test/", "https://ollama.example.test"],
    ["ollama", "http://localhost:11434/", "http://localhost:11434"],
  ] as const)("normalizes valid %s endpoints", (kind, endpoint, normalized) => {
    expect(normalizeProviderEndpoint(kind, endpoint)).toBe(normalized);
  });

  it.each([
    "",
    "provider.example/v1",
    "ftp://provider.example/v1",
    "https://user:pass@provider.example/v1",
    "https://provider.example/v1?private=true",
    "https://provider.example:0/v1",
    "https://provider.example:65536/v1",
  ])("rejects malformed endpoint without creating a revision: %s", (endpoint) => {
    const profiles = new ProviderProfiles(() => "profile-a");
    expect(() =>
      profiles.save({ displayName: "bad", kind: "openai", endpoint, model: "model" }),
    ).toThrow();
    expect(profiles.listLatest()).toEqual([]);
  });
});
