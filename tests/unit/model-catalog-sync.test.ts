import { describe, expect, it } from "vitest";
import {
  ModelCatalogSync,
  modelCatalogContextToken,
  modelCatalogPreviewContextToken,
} from "../../src/adapters/iina/model-catalog-sync.js";

describe("per-window model catalog synchronization", () => {
  it("uses one cache context across trigger sources while isolating profile revisions", () => {
    const base = {
      kind: "openai" as const,
      endpoint: "https://example.test/v1",
      proxyMode: "system" as const,
      profileId: "profile-a",
      profileRevision: 1,
      endpointFingerprint: "fingerprint-a",
    };
    expect(modelCatalogContextToken({ ...base, trigger: "open" })).toBe(
      modelCatalogContextToken({ ...base, trigger: "manual" }),
    );
    expect(modelCatalogContextToken({ ...base, trigger: "profile" })).not.toBe(
      modelCatalogContextToken({ ...base, trigger: "profile", profileRevision: 2 }),
    );
  });

  it("isolates draft credential epochs without accepting credential material", () => {
    const base = {
      trigger: "manual" as const,
      kind: "openai" as const,
      endpoint: "https://example.test/v1",
      proxyMode: "system" as const,
      draftCredentialEpoch: 1,
      credential: { apiKey: "draft-secret" },
    };
    const first = modelCatalogPreviewContextToken(base);
    const next = modelCatalogPreviewContextToken({ ...base, draftCredentialEpoch: 2 });

    expect(first).not.toBe(next);
    expect(first).not.toContain("draft-secret");
  });

  it("coalesces equivalent automatic requests and lets manual refresh take ownership", () => {
    const sync = new ModelCatalogSync();
    expect(
      sync.begin("window-a", {
        requestId: "auto-1",
        contextToken: "context-a",
        trigger: "endpoint",
      }),
    ).toMatchObject({ forwarded: true, ownerRequestId: "auto-1" });
    expect(
      sync.begin("window-a", {
        requestId: "auto-2",
        contextToken: "context-a",
        trigger: "profile",
      }),
    ).toMatchObject({ forwarded: false, ownerRequestId: "auto-1" });
    expect(
      sync.begin("window-a", {
        requestId: "manual-1",
        contextToken: "context-a",
        trigger: "manual",
      }),
    ).toMatchObject({ forwarded: true, ownerRequestId: "manual-1" });
  });

  it("lets a credential refresh replace the automatic owner cancelled by credential save", () => {
    const sync = new ModelCatalogSync();
    sync.begin("window-a", {
      requestId: "before-credential",
      contextToken: "profile-context",
      trigger: "profile",
    });

    expect(
      sync.begin("window-a", {
        requestId: "after-credential",
        contextToken: "profile-context",
        trigger: "credential",
      }),
    ).toEqual({
      forwarded: true,
      ownerRequestId: "after-credential",
      supersededRequestId: "before-credential",
    });
    expect(sync.snapshot("window-a").ownerRequestId).toBe("after-credential");
  });

  it("invalidates cached Claude state across credential, kind, endpoint, route and revision owners", () => {
    const sync = new ModelCatalogSync();
    const claude = modelCatalogContextToken({
      trigger: "manual",
      kind: "claude",
      endpoint: "https://api.anthropic.com",
      proxyMode: "system",
      profileId: "claude-profile",
      profileRevision: 1,
      endpointFingerprint: "fingerprint-1",
    });
    sync.begin("window-a", { requestId: "claude-1", contextToken: claude, trigger: "manual" });
    sync.commit("window-a", {
      requestId: "claude-1",
      ok: true,
      contextKey: "credential-epoch-1",
      models: ["model-a"],
    });
    expect(sync.snapshot("window-a").catalog?.models).toEqual(["model-a"]);
    sync.begin("window-a", {
      requestId: "claude-credential-2",
      contextToken: claude,
      trigger: "credential",
    });
    expect(sync.snapshot("window-a").catalog).toBeNull();
    expect(
      sync.commit("window-a", {
        requestId: "claude-1",
        ok: true,
        contextKey: "stale",
        models: ["stale"],
      }),
    ).toBe(false);

    const variants = [
      modelCatalogContextToken({
        trigger: "profile",
        kind: "openai",
        endpoint: "https://api.anthropic.com",
        proxyMode: "system",
      }),
      modelCatalogContextToken({
        trigger: "profile",
        kind: "claude",
        endpoint: "https://other.example",
        proxyMode: "system",
      }),
      modelCatalogContextToken({
        trigger: "profile",
        kind: "claude",
        endpoint: "https://api.anthropic.com",
        proxyMode: "direct",
      }),
      modelCatalogContextToken({
        trigger: "profile",
        kind: "claude",
        endpoint: "https://api.anthropic.com",
        proxyMode: "system",
        profileId: "claude-profile",
        profileRevision: 2,
        endpointFingerprint: "fingerprint-2",
      }),
    ];
    expect(new Set([claude, ...variants]).size).toBe(variants.length + 1);
  });

  it("commits only the latest owner and keeps the last successful catalog on failure", () => {
    const sync = new ModelCatalogSync();
    sync.begin("window-a", {
      requestId: "old",
      contextToken: "context-a",
      trigger: "endpoint",
    });
    sync.begin("window-a", {
      requestId: "new",
      contextToken: "context-a",
      trigger: "manual",
    });
    expect(
      sync.commit("window-a", {
        requestId: "old",
        ok: true,
        contextKey: "opaque-a",
        models: ["stale"],
      }),
    ).toBe(false);
    expect(
      sync.commit("window-a", {
        requestId: "new",
        ok: true,
        contextKey: "opaque-a",
        models: ["current"],
      }),
    ).toBe(true);
    sync.begin("window-a", {
      requestId: "failed",
      contextToken: "context-a",
      trigger: "manual",
    });
    expect(
      sync.commit("window-a", {
        requestId: "failed",
        ok: false,
        contextKey: "opaque-a",
        category: "network",
        retryable: true,
        userAction: "CHECK_NETWORK",
      }),
    ).toBe(true);
    expect(sync.snapshot("window-a").catalog).toEqual({
      contextKey: "opaque-a",
      models: ["current"],
    });
  });

  it("does not reuse a preview catalog after the draft credential epoch changes", () => {
    const sync = new ModelCatalogSync();
    sync.begin("window-a", {
      requestId: "preview-1",
      contextToken: "preview-epoch-1",
      trigger: "manual",
      cacheResult: false,
    });
    sync.commit("window-a", {
      requestId: "preview-1",
      ok: true,
      contextKey: "opaque-preview-1",
      models: ["model-a"],
    });
    sync.begin("window-a", {
      requestId: "preview-2",
      contextToken: "preview-epoch-2",
      trigger: "manual",
    });

    expect(sync.snapshot("window-a").catalog).toBeNull();
    sync.invalidate("window-a", "preview-epoch-1");
    expect(sync.snapshot("window-a").catalog).toBeNull();
  });

  it("isolates windows and accepts a successful empty catalog", () => {
    const sync = new ModelCatalogSync();
    sync.begin("window-a", { requestId: "a", contextToken: "shared", trigger: "open" });
    sync.begin("window-b", { requestId: "b", contextToken: "shared", trigger: "open" });
    sync.commit("window-a", {
      requestId: "a",
      ok: true,
      contextKey: "opaque-a",
      models: [],
    });
    sync.commit("window-b", {
      requestId: "b",
      ok: true,
      contextKey: "opaque-b",
      models: ["model-b"],
    });
    expect(sync.snapshot("window-a").catalog?.models).toEqual([]);
    expect(sync.snapshot("window-b").catalog?.models).toEqual(["model-b"]);
  });
});
