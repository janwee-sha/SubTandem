import { describe, expect, it } from "vitest";
import { normalizeProviderEndpoint, ProviderProfiles } from "../../src/providers/profiles.js";
import { sanitizedProfileView } from "../../src/domain/messages.js";

describe("immutable provider profile revisions", () => {
  it("stores DeepSeek as an independent normalized Profile identity", () => {
    const profiles = new ProviderProfiles(() => "deepseek-profile");
    const deepseek = profiles.save({
      displayName: "DeepSeek",
      kind: "deepseek",
      endpoint: "https://API.DeepSeek.com/",
      model: " exact-model ",
    });
    const openai = profiles.save({
      profileId: "openai-profile",
      expectedRevision: 0,
      displayName: "OpenAI",
      kind: "openai",
      endpoint: "https://api.deepseek.com",
      model: "exact-model",
    });
    expect(deepseek).toMatchObject({
      kind: "deepseek",
      endpoint: "https://api.deepseek.com",
      model: "exact-model",
    });
    expect(deepseek.endpointFingerprint).not.toBe(openai.endpointFingerprint);
    expect(profiles.listLatest()).toEqual([deepseek, openai]);
  });

  it("publishes a new identity when a DeepSeek Profile changes kind", () => {
    const profiles = new ProviderProfiles(() => "kind-change-profile");
    const deepseek = profiles.save({
      displayName: "DeepSeek",
      kind: "deepseek",
      endpoint: "https://api.deepseek.com",
      model: "exact-model",
    });
    const ollama = profiles.save({
      profileId: deepseek.profileId,
      expectedRevision: deepseek.revision,
      displayName: "Ollama",
      kind: "ollama",
      endpoint: "http://127.0.0.1:11434",
      model: "qwen",
    });
    expect(ollama).toMatchObject({ kind: "ollama", revision: 2 });
    expect(ollama.endpointFingerprint).not.toBe(deepseek.endpointFingerprint);
    expect(profiles.get(deepseek.profileId, 1)).toEqual(deepseek);
  });

  it("keeps an existing display name and internal kind while using a custom OpenAI API root", () => {
    const profiles = new ProviderProfiles(() => "existing-openai-profile");
    const saved = profiles.save({
      displayName: "OpenAI-compatible",
      kind: "openai",
      endpoint: "https://compatible.example.test/custom/v1",
      model: "custom-model",
    });
    expect(saved).toMatchObject({
      displayName: "OpenAI-compatible",
      kind: "openai",
      endpoint: "https://compatible.example.test/custom/v1",
      model: "custom-model",
    });
  });

  it("exposes only configured state for an Ollama credential", () => {
    const view = sanitizedProfileView({
      profileId: "ollama-profile",
      revision: 1,
      displayName: "Ollama",
      kind: "ollama",
      endpoint: "https://ollama.example.test",
      endpointFingerprint: "fingerprint",
      credential: { apiKey: "remote-secret" },
    });
    expect(view.credentialConfigured).toBe(true);
    expect(JSON.stringify(view)).not.toContain("remote-secret");
  });

  it("normalizes endpoints, fingerprints semantic fields and creates immutable revisions", () => {
    const profiles = new ProviderProfiles(() => "00000000-0000-4000-8000-000000000001");
    const first = profiles.save({
      displayName: "OpenAI",
      kind: "openai",
      endpoint: "https://api.example.test/v1/",
      model: "model-a",
    });
    const second = profiles.save({
      profileId: first.profileId,
      expectedRevision: 1,
      displayName: "OpenAI",
      kind: "openai",
      endpoint: "https://api.example.test/v2",
      model: "model-a",
    });
    expect(first).toMatchObject({ revision: 1, endpoint: "https://api.example.test/v1/" });
    expect(second.revision).toBe(2);
    expect(second.endpointFingerprint).not.toBe(first.endpointFingerprint);
    expect(profiles.get(first.profileId, 1)).toEqual(first);
    expect(() =>
      profiles.save({
        profileId: first.profileId,
        expectedRevision: 1,
        displayName: "stale",
        kind: "openai",
        endpoint: "https://api.example.test",
        model: "m",
      }),
    ).toThrow(/STALE_PROFILE_REVISION/);
  });

  it("treats the network route as selected profile identity", () => {
    const profiles = new ProviderProfiles(() => "route-profile");
    const system = profiles.save({
      displayName: "Remote",
      kind: "openai",
      endpoint: "https://api.example.test/v1",
      model: "model",
      proxyMode: "system",
    });
    const direct = profiles.save({
      profileId: system.profileId,
      expectedRevision: 1,
      displayName: "Remote",
      kind: "openai",
      endpoint: "https://api.example.test/v1",
      model: "model",
      proxyMode: "direct",
    });

    expect(system.proxyMode).toBe("system");
    expect(direct.proxyMode).toBe("direct");
    expect(direct.endpointFingerprint).not.toBe(system.endpointFingerprint);
  });

  it("requires exact per-window selection and leases old revisions independently", () => {
    const profiles = new ProviderProfiles(() => "00000000-0000-4000-8000-000000000001");
    const first = profiles.save({
      displayName: "Local",
      kind: "ollama",
      endpoint: "http://127.0.0.1:11434",
      model: "qwen",
    });
    expect(first.endpoint).toBe("http://127.0.0.1:11434");
    profiles.select("window-A", first.profileId, 1, first.endpointFingerprint);
    profiles.select("window-B", first.profileId, 1, first.endpointFingerprint);
    profiles.lease("window-B", first.profileId, 1);
    profiles.save({
      profileId: first.profileId,
      expectedRevision: 1,
      editingWindowId: "window-A",
      displayName: "Local",
      kind: "ollama",
      endpoint: "http://localhost:11434",
      model: "qwen",
    });
    expect(profiles.selection("window-A")).toBeNull();
    expect(profiles.selection("window-B")).toMatchObject({ revision: 1 });
    expect(profiles.get(first.profileId, 1)).not.toBeNull();
    profiles.release("window-B", first.profileId, 1);
  });

  it.each([
    ["openai", "https://api.example.test/v1", "https://api.example.test/v1"],
    ["openai", "http://127.0.0.1:8080/v1", "http://127.0.0.1:8080/v1"],
    ["openai", "http://192.168.50.4:8080/v1", "http://192.168.50.4:8080/v1"],
    ["openai", "http://api.example.test:8080/v1", "http://api.example.test:8080/v1"],
    ["ollama", "https://ollama.example.test/", "https://ollama.example.test"],
    ["ollama", "http://localhost:11434/", "http://localhost:11434"],
    ["ollama", "http://10.0.0.8:11434/", "http://10.0.0.8:11434"],
    ["ollama", "http://ollama.example.test:11434/", "http://ollama.example.test:11434"],
  ] as const)("accepts complete HTTP(S) endpoint %s %s", (kind, endpoint, normalized) => {
    const profiles = new ProviderProfiles(() => `${kind}-${endpoint}`);
    const saved = profiles.save({ displayName: kind, kind, endpoint, model: "model" });

    expect(saved.endpoint).toBe(normalized);
    expect(profiles.get(saved.profileId, saved.revision)).toEqual(saved);
    expect(
      profiles.select("window", saved.profileId, saved.revision, saved.endpointFingerprint),
    ).toMatchObject({ endpointFingerprint: saved.endpointFingerprint });
  });

  it.each([
    "",
    "provider.example/v1",
    "ftp://provider.example/v1",
    "https://user:pass@provider.example/v1",
    "https://provider.example/v1?private=true",
    "https://provider.example/v1#private",
    "https:///v1",
    "https://[::1/v1",
    "https://provider.example:0/v1",
    "https://provider.example:65536/v1",
    "https://provider.example:invalid/v1",
  ])("rejects malformed endpoint without creating a revision: %s", (endpoint) => {
    const profiles = new ProviderProfiles(() => "00000000-0000-4000-8000-000000000001");
    expect(() =>
      profiles.save({
        displayName: "bad",
        kind: "openai",
        endpoint,
        model: "m",
      }),
    ).toThrow();
    expect(profiles.listLatest()).toEqual([]);
  });

  it("preserves an existing selection after a rejected update and rejects forged fingerprints", () => {
    const profiles = new ProviderProfiles(() => "00000000-0000-4000-8000-000000000001");
    const valid = profiles.save({
      displayName: "Remote",
      kind: "openai",
      endpoint: "https://api.example.test/v1",
      model: "m",
    });
    profiles.select("window", valid.profileId, valid.revision, valid.endpointFingerprint);
    expect(() =>
      profiles.save({
        profileId: valid.profileId,
        expectedRevision: valid.revision,
        editingWindowId: "window",
        displayName: "bad",
        kind: "openai",
        endpoint: "https://user:pass@example.test",
        model: "m",
      }),
    ).toThrow(/INVALID_ENDPOINT/);
    expect(profiles.selection("window")).toMatchObject({ revision: valid.revision });
    expect(profiles.get(valid.profileId, 2)).toBeNull();
    expect(() => profiles.select("window", valid.profileId, 1, "forged")).toThrow(
      /SELECTION_MISMATCH/,
    );
  });

  it("preserves every OpenAI endpoint as a literal API root", () => {
    expect(
      normalizeProviderEndpoint("openai", "https://api.example.test/v1/chat/completions/"),
    ).toBe("https://api.example.test/v1/chat/completions/");

    const profiles = new ProviderProfiles(() => "unused");
    const root = profiles.save({
      profileId: "root",
      expectedRevision: 0,
      displayName: "Root",
      kind: "openai",
      endpoint: "https://api.example.test/v1",
      model: "model",
    });
    const full = profiles.save({
      profileId: "full",
      expectedRevision: 0,
      displayName: "Full",
      kind: "openai",
      endpoint: "https://api.example.test/v1/chat/completions",
      model: "model",
    });
    expect(root.endpoint).toBe("https://api.example.test/v1");
    expect(full.endpoint).toBe("https://api.example.test/v1/chat/completions");
    expect(full.endpointFingerprint).not.toBe(root.endpointFingerprint);
  });

  it("clears every window selection and lease without deleting profile metadata", () => {
    const profiles = new ProviderProfiles(() => "00000000-0000-4000-8000-000000000001");
    const saved = profiles.save({
      displayName: "Remote",
      kind: "openai",
      endpoint: "https://api.example.test/v1",
      model: "model",
    });
    profiles.select("window-A", saved.profileId, saved.revision, saved.endpointFingerprint);
    profiles.select("window-B", saved.profileId, saved.revision, saved.endpointFingerprint);
    profiles.lease("window-A", saved.profileId, saved.revision);

    expect(profiles.clearAuthorizations()).toEqual(["window-A", "window-B"]);
    expect(profiles.selection("window-A")).toBeNull();
    expect(profiles.selection("window-B")).toBeNull();
    expect(profiles.get(saved.profileId, saved.revision)).toEqual(saved);
  });

  it("deletes every revision and reports only windows using that profile", () => {
    let sequence = 0;
    const profiles = new ProviderProfiles(() => `profile-${++sequence}`);
    const deleted = profiles.save({
      displayName: "Delete me",
      kind: "openai",
      endpoint: "https://delete.example/v1",
      model: "model",
    });
    profiles.save({
      profileId: deleted.profileId,
      expectedRevision: 1,
      displayName: "Delete me",
      kind: "openai",
      endpoint: "https://delete.example/v2",
      model: "model",
    });
    const retained = profiles.save({
      displayName: "Keep me",
      kind: "ollama",
      endpoint: "http://127.0.0.1:11434",
      model: "qwen",
    });
    profiles.select(
      "window-A",
      deleted.profileId,
      2,
      profiles.get(deleted.profileId, 2)!.endpointFingerprint,
    );
    profiles.select("window-B", retained.profileId, 1, retained.endpointFingerprint);
    profiles.lease("window-C", deleted.profileId, 1);

    expect(profiles.delete(deleted.profileId)).toEqual(["window-A", "window-C"]);
    expect(profiles.get(deleted.profileId, 1)).toBeNull();
    expect(profiles.get(deleted.profileId, 2)).toBeNull();
    expect(profiles.selection("window-A")).toBeNull();
    expect(profiles.selection("window-B")).toMatchObject({ profileId: retained.profileId });
    expect(profiles.listLatest()).toEqual([retained]);
    expect(() => profiles.delete(deleted.profileId)).toThrow(/PROFILE_NOT_FOUND/);
  });
});
