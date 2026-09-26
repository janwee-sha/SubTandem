import { describe, expect, it } from "vitest";
import { ProviderProfiles } from "../../src/providers/profiles.js";
import { globalProviderHarness } from "../helpers/global-provider-harness.js";

const variants = [
  "  HTTPS://EXAMPLE.TEST:443/Root/%41///  ",
  "https://example.test:443/Root/%41",
  "http://example.test:443/Root/%41",
  "https://other.test:443/Root/%41",
  "https://example.test/Root/%41",
  "https://example.test:0443/Root/%41",
  "https://example.test:443/root/%41",
  "https://example.test:443/Root/A",
  "https://example.test:443//Root/%41",
  "https://example.test:443/./Root/%41",
  "https://example.test:443/v1/Root/%41",
];
const flush = async () => {
  for (let i = 0; i < 8; i++) await Promise.resolve();
};

for (const kind of ["openai", "claude", "deepseek", "ollama"] as const) {
  const profiles = new ProviderProfiles(() => "saved");
  const saved = profiles.save({
    kind,
    endpoint: "https://Example.test:443/Root/%41",
    proxyMode: "direct",
    model: "model",
    displayName: "Profile",
  });
  const sourceProfile = {
    profileId: saved.profileId,
    profileRevision: saved.revision,
    endpointFingerprint: saved.endpointFingerprint,
  };
  describe(`${kind} saved credential boundary`, () => {
    for (const operation of ["test", "automatic", "manual"] as const) {
      it.each(variants)(`${operation} uses the saved Key at %s`, async (endpoint) => {
        const h = await globalProviderHarness([saved]);
        const payload =
          operation === "test"
            ? {
                kind,
                endpoint,
                proxyMode: "direct",
                model: "changed-model",
                sourceProfile,
                drawerId: "drawer",
                draftRevision: 1,
                credential: { source: "saved" },
              }
            : {
                kind,
                endpoint,
                proxyMode: "direct",
                trigger: operation === "manual" ? "manual" : "endpoint",
                ...sourceProfile,
              };
        const work = h.send(operation === "test" ? "provider:test" : "provider:models", payload);
        await flush();
        expect(h.reads).toEqual(["saved"]);
        h.secrets.releaseNext({ apiKey: "saved-key" });
        await flush();
        expect(h.transport.calls).toHaveLength(1);
        const header = kind === "claude" ? "x-api-key" : "Authorization";
        expect(h.transport.calls[0]!.headers[header]).toBe(
          kind === "claude" ? "saved-key" : "Bearer saved-key",
        );
        expect(h.transport.calls[0]!.url).toContain(endpoint.trim().replace(/\/+$/, ""));
        const cancelName = operation === "test" ? "provider:test-cancel" : "provider:models-cancel";
        await h.send(
          cancelName,
          operation === "test" ? { testRequestId: "request" } : { modelRequestId: "request" },
          "window",
          "cancel",
        );
        h.transport.responses.releaseNext({ statusCode: 200, headers: {}, bodyText: "{}" });
        await work;
      });
    }
    for (const operation of ["test", "automatic", "manual"] as const) {
      it(`${operation} uses the saved Key on a changed route`, async () => {
        const h = await globalProviderHarness([saved]);
        const payload =
          operation === "test"
            ? {
                kind,
                endpoint: "https://other.test:443/Root/%41",
                proxyMode: "system",
                model: "model",
                sourceProfile,
                drawerId: "drawer",
                draftRevision: 1,
                credential: { source: "saved" },
              }
            : {
                kind,
                endpoint: "https://other.test:443/Root/%41",
                proxyMode: "system",
                trigger: operation === "manual" ? "manual" : "endpoint",
                ...sourceProfile,
              };
        const work = h.send(operation === "test" ? "provider:test" : "provider:models", payload);
        await h.secrets.waitForPending();
        h.secrets.releaseNext({ apiKey: "saved-key" });
        await flush();
        expect(h.transport.calls[0]).toMatchObject({ proxyMode: "system" });
        expect(h.transport.calls[0]!.url).toContain("https://other.test:443/Root/%41");
        expect(
          h.transport.calls[0]!.headers[kind === "claude" ? "x-api-key" : "Authorization"],
        ).toContain("saved-key");
        await h.send(
          operation === "test" ? "provider:test-cancel" : "provider:models-cancel",
          operation === "test" ? { testRequestId: "request" } : { modelRequestId: "request" },
          "window",
          "cancel",
        );
        h.transport.responses.releaseNext({ statusCode: 200, headers: {}, bodyText: "{}" });
        await work;
      });
    }
    it.each(["models", "test"] as const)(
      "does not use a Key read before %s baseline invalidation",
      async (operation) => {
        const h = await globalProviderHarness([saved]);
        const payload =
          operation === "test"
            ? {
                kind,
                endpoint: saved.endpoint,
                proxyMode: "direct",
                model: "model",
                sourceProfile,
                drawerId: "drawer",
                draftRevision: 1,
                credential: { source: "saved" },
              }
            : {
                kind,
                endpoint: saved.endpoint,
                proxyMode: "direct",
                trigger: "manual",
                ...sourceProfile,
              };
        const work = h.send(`provider:${operation}`, payload);
        await h.secrets.waitForPending();
        h.profiles.delete(saved.profileId);
        h.secrets.releaseNext({ apiKey: "old-key" });
        await work;
        expect(h.transport.calls).toHaveLength(0);
        expect(h.replies.some((reply) => reply.data.ok === true)).toBe(false);
      },
    );
    it.each(["models", "test"] as const)(
      "invalidates %s before a stale Key read completes",
      async (operation) => {
        const h = await globalProviderHarness([saved]);
        const payload =
          operation === "test"
            ? {
                kind,
                endpoint: saved.endpoint,
                proxyMode: "direct",
                model: "model",
                sourceProfile,
                drawerId: "drawer",
                draftRevision: 1,
                credential: { source: "saved" },
              }
            : {
                kind,
                endpoint: saved.endpoint,
                proxyMode: "direct",
                trigger: "manual",
                ...sourceProfile,
              };
        const work = h.send(`provider:${operation}`, payload);
        await h.secrets.waitForPending();
        await h.send(
          "credential:set",
          {
            profileId: saved.profileId,
            expectedRevision: saved.revision,
            fields: { apiKey: "replacement-key" },
          },
          "other-window",
          "change",
        );
        expect(h.replies.some((reply) => reply.name === "credential:result")).toBe(true);
        h.secrets.releaseNext({ apiKey: "old-key" });
        await work;
        expect(h.transport.calls).toHaveLength(0);
        expect(h.replies.some((reply) => reply.data.ok === true)).toBe(false);
      },
    );
    it.each(["kind", "revision", "fingerprint", "profile"] as const)(
      "rejects saved Test with changed %s before reading credentials",
      async (field) => {
        const h = await globalProviderHarness([saved]);
        await h.send("provider:test", {
          kind: field === "kind" ? (kind === "ollama" ? "openai" : "ollama") : kind,
          endpoint: saved.endpoint,
          proxyMode: "direct",
          model: "model",
          sourceProfile: {
            ...sourceProfile,
            ...(field === "revision" ? { profileRevision: 9 } : {}),
            ...(field === "fingerprint" ? { endpointFingerprint: "stale" } : {}),
            ...(field === "profile" ? { profileId: "different" } : {}),
          },
          drawerId: "drawer",
          draftRevision: 1,
          credential: { source: "saved" },
        });
        expect(h.reads).toEqual([]);
        expect(h.transport.calls).toHaveLength(0);
      },
    );
    it("does not use the saved Key after a draft Service type switch", async () => {
      const h = await globalProviderHarness([saved]);
      const nextKind = kind === "ollama" ? "openai" : "ollama";
      const work = h.send("provider:models", {
        kind: nextKind,
        endpoint: "https://other.test:443/Root/%41",
        proxyMode: "system",
        trigger: "manual",
        ...sourceProfile,
      });
      await flush();
      expect(h.reads).toEqual([]);
      expect(h.transport.calls).toHaveLength(1);
      expect(h.transport.calls[0]!.headers["Authorization"]).toBeUndefined();
      await h.send("provider:models-cancel", { modelRequestId: "request" }, "window", "cancel");
      h.transport.responses.releaseNext({ statusCode: 200, headers: {}, bodyText: "{}" });
      await work;
    });
    it("uses a manual entered Key without reading the saved Key", async () => {
      const h = await globalProviderHarness([saved]);
      const work = h.send("provider:models-preview", {
        kind,
        endpoint: "https://other.test:443/Root/%41",
        proxyMode: "system",
        trigger: "manual",
        draftCredentialEpoch: 1,
        credential: { apiKey: "entered-key" },
        sourceProfile,
      });
      await flush();
      expect(h.reads).toEqual([]);
      expect(h.transport.calls).toHaveLength(1);
      expect(
        h.transport.calls[0]!.headers[kind === "claude" ? "x-api-key" : "Authorization"],
      ).toContain("entered-key");
      expect(h.transport.calls[0]).toMatchObject({ proxyMode: "system" });
      expect(h.transport.calls[0]!.url).toContain("https://other.test:443/Root/%41");
      await h.send("provider:models-cancel", { modelRequestId: "request" }, "window", "cancel");
      h.transport.responses.releaseNext({ statusCode: 200, headers: {}, bodyText: "{}" });
      await work;
    });
    it("prefers the entered Test Key at the selected Endpoint and route", async () => {
      const h = await globalProviderHarness([saved]);
      const work = h.send("provider:test", {
        kind,
        endpoint: "https://other.test:443/Root/%41",
        proxyMode: "system",
        model: "model",
        sourceProfile,
        drawerId: "drawer",
        draftRevision: 1,
        credential: { source: "entered", apiKey: "entered-key" },
      });
      await flush();
      expect(h.reads).toEqual([]);
      expect(h.transport.calls).toHaveLength(1);
      expect(h.transport.calls[0]).toMatchObject({ proxyMode: "system" });
      expect(h.transport.calls[0]!.url).toContain("https://other.test:443/Root/%41");
      expect(
        h.transport.calls[0]!.headers[kind === "claude" ? "x-api-key" : "Authorization"],
      ).toContain("entered-key");
      await h.send("provider:test-cancel", { testRequestId: "request" }, "window", "cancel");
      h.transport.responses.releaseNext({ statusCode: 200, headers: {}, bodyText: "{}" });
      await work;
    });
    it("validates the baseline even for a manual entered Key", async () => {
      const h = await globalProviderHarness([saved]);
      h.profiles.delete(saved.profileId);
      await h.send("provider:models-preview", {
        kind,
        endpoint: saved.endpoint,
        proxyMode: "direct",
        trigger: "manual",
        draftCredentialEpoch: 1,
        credential: { apiKey: "entered-key" },
        sourceProfile,
      });
      expect(h.reads).toEqual([]);
      expect(h.transport.calls).toHaveLength(0);
    });
  });
}
