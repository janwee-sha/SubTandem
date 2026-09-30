import { describe, expect, it } from "vitest";
import { ProviderProfiles } from "../../src/providers/profiles.js";
import { globalProviderHarness } from "../helpers/global-provider-harness.js";

const changedEndpoints = [
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
for (const kind of ["openai", "claude", "deepseek", "ollama"] as const) {
  const saved = new ProviderProfiles(() => "10000000-0000-4000-8000-000000000001").save({
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
  const input = (operation: "test" | "models", endpoint = saved.endpoint) =>
    operation === "test"
      ? {
          kind,
          endpoint,
          proxyMode: "direct",
          model: "model",
          sourceProfile,
          drawerId: "drawer",
          draftRevision: 1,
          credential: { source: "saved" },
        }
      : { kind, endpoint, proxyMode: "direct", trigger: "manual", ...sourceProfile };
  describe(`${kind} native saved credential authority`, () => {
    for (const operation of ["test", "models"] as const) {
      it.each([saved.endpoint, " HTTPS://EXAMPLE.TEST:443/Root/%41/// "])(
        `${operation} binds an equivalent endpoint to the persisted configuration: %s`,
        async (endpoint) => {
          const h = await globalProviderHarness([saved]);
          const work = h.send(`provider:${operation}`, input(operation, endpoint));
          await h.transport.responses.waitForPending();
          expect(h.transport.calls[0]).toMatchObject({
            credential: { source: "saved", ...sourceProfile, kind },
            provider: { kind, endpoint: saved.endpoint, model: saved.model, proxyMode: "direct" },
            owner: { senderId: "window" },
            purpose: operation,
          });
          expect(h.transport.calls[0]!.headers).not.toHaveProperty("Authorization");
          expect(h.transport.calls[0]!.headers).not.toHaveProperty("x-api-key");
          expect(h.reads).toEqual([]);
          await h.send(
            operation === "test" ? "provider:test-cancel" : "provider:models-cancel",
            operation === "test" ? { testRequestId: "request" } : { modelRequestId: "request" },
            "window",
            "cancel",
          );
          h.transport.responses.releaseNext({ statusCode: 200, headers: {}, bodyText: "{}" });
          await work;
        },
      );
      it.each(changedEndpoints)(
        `${operation} rejects a saved reference at a changed endpoint: %s`,
        async (endpoint) => {
          const h = await globalProviderHarness([saved]);
          await h.send(`provider:${operation}`, input(operation, endpoint));
          expect(h.transport.calls).toEqual([]);
          expect(h.replies.at(-1)?.data).toMatchObject({ ok: false });
        },
      );
      it(`${operation} rejects changed proxy routing and a deleted baseline`, async () => {
        const h = await globalProviderHarness([saved]);
        await h.send(`provider:${operation}`, { ...input(operation), proxyMode: "system" });
        h.profiles.delete(saved.profileId);
        await h.send(`provider:${operation}`, input(operation), "window", "after-delete");
        expect(h.transport.calls).toEqual([]);
      });
      it(`${operation} discards late results after a committed encrypted replacement`, async () => {
        const h = await globalProviderHarness([saved]);
        const work = h.send(`provider:${operation}`, input(operation));
        await h.transport.responses.waitForPending();
        await h.save(
          {
            profileId: saved.profileId,
            expectedRevision: 1,
            displayName: saved.displayName,
            kind,
            endpoint: saved.endpoint,
            model: "model",
            proxyMode: "direct",
          },
          "synthetic-replacement-key",
        );
        h.transport.responses.releaseNext({ statusCode: 200, headers: {}, bodyText: "{}" });
        await work;
        expect(h.transport.cancelled).toHaveLength(1);
        expect(
          h.replies.filter(
            (reply) => reply.name === `provider:${operation}-result` && reply.data.ok === true,
          ),
        ).toEqual([]);
        expect(h.authority.snapshot.profiles[0]).toMatchObject({
          revision: 2,
          credentialConfigured: true,
        });
        expect(JSON.stringify(h.saveCalls)).not.toContain("synthetic-replacement-key");
      });
    }
    it.each(["kind", "revision", "fingerprint", "profile", "model"])(
      "rejects a saved Test with changed %s",
      async (field) => {
        const h = await globalProviderHarness([saved]);
        await h.send("provider:test", {
          ...input("test"),
          kind: field === "kind" ? (kind === "ollama" ? "openai" : "ollama") : kind,
          model: field === "model" ? "other-model" : "model",
          sourceProfile: {
            ...sourceProfile,
            ...(field === "revision" ? { profileRevision: 9 } : {}),
            ...(field === "fingerprint" ? { endpointFingerprint: "stale" } : {}),
            ...(field === "profile" ? { profileId: "other" } : {}),
          },
        });
        expect(h.transport.calls).toEqual([]);
      },
    );
    it("rejects plaintext entered drafts at both request boundaries", async () => {
      const h = await globalProviderHarness([saved]);
      await h.send("provider:test", {
        ...input("test"),
        credential: { source: "entered", apiKey: "synthetic-entered-key" },
      });
      await h.send("provider:models-preview", {
        kind,
        endpoint: saved.endpoint,
        proxyMode: "direct",
        trigger: "manual",
        draftCredentialEpoch: 1,
        sourceProfile,
        credential: { apiKey: "synthetic-entered-key" },
      });
      expect(h.transport.calls).toEqual([]);
      expect(JSON.stringify(h.replies)).not.toContain("synthetic-entered-key");
    });
  });
}
