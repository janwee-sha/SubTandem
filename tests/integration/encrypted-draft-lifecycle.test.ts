import { describe, expect, it, vi } from "vitest";
import { globalProviderHarness } from "../helpers/global-provider-harness.js";
import { ProviderProfiles } from "../../src/providers/profiles.js";

const saved = new ProviderProfiles(() => "10000000-0000-4000-8000-000000000001").save({
  kind: "openai",
  endpoint: "https://saved.test/v1",
  proxyMode: "direct",
  model: "model-a",
  displayName: "Saved",
});
const source = {
  profileId: saved.profileId,
  profileRevision: saved.revision,
  endpointFingerprint: saved.endpointFingerprint,
};
const snapshot = (purpose: "draft-test" | "draft-models", existing = true) => ({
  kind: "openai" as const,
  endpoint: "https://draft.test/v1",
  proxyMode: "direct" as const,
  model: "model-b",
  purpose,
  sourceProfile: existing ? source : null,
  save: null,
});
const response = {
  statusCode: 200,
  headers: {},
  bodyText: JSON.stringify({
    choices: [
      { message: { content: JSON.stringify({ translations: [{ id: "probe", text: "hola" }] }) } },
    ],
  }),
};

describe("production encrypted draft lifecycle", () => {
  it("returns an invalidated Test result when a resumed window has lost its channel owner", async () => {
    const h = await globalProviderHarness();
    const draft = await h.openDraft();
    const payload = draft.seal("synthetic-resumed-key", snapshot("draft-test", false));
    h.close("draft-window");
    await h.send("provider:draft-test", payload, "draft-window", "draft-request");
    expect(h.replies.findLast((reply) => reply.name === "provider:test-result")).toMatchObject({
      sender: "draft-window",
      data: {
        requestId: "draft-request",
        drawerId: payload.drawerId,
        draftRevision: 1,
        ok: false,
        code: "TEST_INVALIDATED",
      },
    });
    expect(h.transport.calls).toEqual([]);
    expect(h.draftValues.size).toBe(0);
  });

  it("reuses one absolute deadline and encrypted reference across paginated child jobs", async () => {
    const h = await globalProviderHarness();
    const draft = await h.openDraft();
    const deadline = Date.now() + 10_000;
    const work = h.send(
      "provider:draft-models",
      draft.seal(
        "synthetic-page-key",
        {
          ...snapshot("draft-models", false),
          kind: "claude",
          endpoint: "https://draft.test",
          model: null,
        },
        "draft-request",
        deadline,
      ),
      "draft-window",
      "draft-request",
    );
    await h.transport.responses.waitForPending();
    h.transport.responses.releaseNext({
      statusCode: 200,
      headers: {},
      bodyText: JSON.stringify({ data: [{ id: "first" }], has_more: true, last_id: "first" }),
    });
    await h.transport.responses.waitForPending();
    expect(h.transport.calls).toHaveLength(2);
    expect(h.transport.calls[1]!.credential).toEqual(h.transport.calls[0]!.credential);
    expect(
      h.transport.calls.every(
        (call) => call.owner.requestId === "draft-request" && call.timeoutMs <= 10_000,
      ),
    ).toBe(true);
    expect((h.transport.calls[1]!.credential as any).deadlineMs).toBe(deadline);
    h.transport.responses.releaseNext({
      statusCode: 200,
      headers: {},
      bodyText: JSON.stringify({ data: [{ id: "second" }], has_more: false }),
    });
    await work;
    expect(h.replies.at(-1)!.data.models).toEqual(["first", "second"]);
    expect(h.draftValues.size).toBe(0);
  });

  it("drops a late result after its window closes", async () => {
    const h = await globalProviderHarness();
    const draft = await h.openDraft();
    const work = h.send(
      "provider:draft-test",
      draft.seal("synthetic-window-close-key", snapshot("draft-test", false)),
      "draft-window",
      "draft-request",
    );
    await h.transport.responses.waitForPending();
    h.close("draft-window");
    h.transport.responses.releaseNext(response);
    await work;
    expect(h.draftValues.size).toBe(0);
    expect(h.replies.some((reply) => reply.name === "provider:test-result")).toBe(false);
  });

  it("never delivers a result or issues another job after the original deadline", async () => {
    const h = await globalProviderHarness();
    const draft = await h.openDraft();
    const deadline = Date.now() + 1000;
    const work = h.send(
      "provider:draft-test",
      draft.seal("synthetic-timeout-key", snapshot("draft-test", false), "draft-request", deadline),
      "draft-window",
      "draft-request",
    );
    await h.transport.responses.waitForPending();
    const clock = vi.spyOn(Date, "now").mockReturnValue(deadline + 1);
    try {
      h.transport.responses.releaseNext(response);
      await work;
    } finally {
      clock.mockRestore();
    }
    expect(h.transport.calls).toHaveLength(1);
    expect(h.replies.some((reply) => reply.name === "provider:test-result" && reply.data.ok)).toBe(
      false,
    );
    expect(h.draftValues.size).toBe(0);
  });
  it.each([true, false])(
    "uses a sealed click-time value at a draft endpoint without persistence: source=%s",
    async (existing) => {
      const h = await globalProviderHarness(existing ? [saved] : []);
      const draft = await h.openDraft("draft-window", existing ? source : null);
      const payload = draft.seal("synthetic-draft-click-key", snapshot("draft-test", existing));
      const work = h.send("provider:draft-test", payload, "draft-window", "draft-request");
      await Promise.race([work, h.transport.responses.waitForPending()]);
      expect(h.transport.calls[0]).toMatchObject({
        credential: { source: "draft", purpose: "draft-test" },
        provider: { endpoint: "https://draft.test/v1", model: "model-b" },
      });
      expect([...h.draftValues.values()]).toEqual(["synthetic-draft-click-key"]);
      expect(JSON.stringify(h.draftCalls)).not.toContain("synthetic-draft-click-key");
      h.transport.responses.releaseNext(response);
      await work;
      expect(h.draftValues.size).toBe(0);
      expect(h.draftCalls.at(-1)?.action).toBe("finish");
      expect(h.saveCalls).toEqual([]);
      expect(h.authority.snapshot.activation).toBeNull();
      expect(h.authority.snapshot.profiles).toHaveLength(existing ? 1 : 0);
    },
  );

  it("keeps an explicitly cleared value empty while the saved Profile remains configured", async () => {
    const h = await globalProviderHarness([saved]);
    const draft = await h.openDraft("draft-window", source);
    const work = h.send(
      "provider:draft-test",
      draft.seal("", snapshot("draft-test")),
      "draft-window",
      "draft-request",
    );
    await Promise.race([work, h.transport.responses.waitForPending()]);
    expect([...h.draftValues.values()]).toEqual([""]);
    h.transport.responses.releaseNext(response);
    await work;
    expect(h.authority.snapshot.profiles[0]?.credentialConfigured).toBe(true);
    expect(h.saveCalls).toEqual([]);
  });

  it("revokes the owner before a delayed begin can create a provider job", async () => {
    const h = await globalProviderHarness([saved]);
    h.holdDraftBegins();
    const draft = await h.openDraft("draft-window", source);
    const work = h.send(
      "provider:draft-test",
      draft.seal("synthetic-cancel-key", snapshot("draft-test")),
      "draft-window",
      "draft-request",
    );
    await Promise.race([work, h.draftStarts.waitForPending()]);
    expect(h.draftStarts.pendingCount).toBe(1);
    await h.send(
      "provider:test-cancel",
      { testRequestId: "draft-request" },
      "draft-window",
      "cancel",
    );
    h.draftStarts.releaseNext();
    await work;
    expect(h.transport.calls).toEqual([]);
    expect(h.draftValues.size).toBe(0);
    expect(h.draftCalls.some((call) => call.action === "cancel")).toBe(true);
    expect(h.replies.some((reply) => reply.name === "provider:test-result" && reply.data.ok)).toBe(
      false,
    );
  });

  it("finishes encrypted model discovery without saving the draft or caching its result as a saved catalog", async () => {
    const h = await globalProviderHarness([saved]);
    const draft = await h.openDraft("draft-window", source);
    const work = h.send(
      "provider:draft-models",
      draft.seal("synthetic-model-click-key", snapshot("draft-models")),
      "draft-window",
      "draft-request",
    );
    await Promise.race([work, h.transport.responses.waitForPending()]);
    expect(h.transport.calls[0]).toMatchObject({
      credential: { source: "draft", purpose: "draft-models" },
      purpose: "models",
    });
    h.transport.responses.releaseNext({
      statusCode: 200,
      headers: {},
      bodyText: JSON.stringify({ data: [{ id: "draft-model" }] }),
    });
    await work;
    expect(h.replies.at(-1)).toMatchObject({
      name: "provider:models-result",
      data: { ok: true, models: ["draft-model"] },
    });
    expect(h.draftValues.size).toBe(0);
    expect(h.authority.snapshot.profiles[0]?.model).toBe("model-a");
  });
});
