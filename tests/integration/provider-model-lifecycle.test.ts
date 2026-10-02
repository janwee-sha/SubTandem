import { afterEach, describe, expect, it, vi } from "vitest";
import { globalProviderHarness } from "../helpers/global-provider-harness.js";

const kinds = ["openai", "claude", "deepseek", "ollama"] as const;
const payload = (kind: (typeof kinds)[number]) => ({
  kind,
  endpoint: "https://fixture.test",
  proxyMode: "direct",
  trigger: "manual",
});
const response = (kind: (typeof kinds)[number]) => ({
  statusCode: 200,
  headers: {},
  bodyText: JSON.stringify(
    kind === "ollama"
      ? { models: [{ model: "model" }] }
      : { data: [{ id: "model" }], has_more: false },
  ),
});
afterEach(() => vi.unstubAllGlobals());

describe.each(kinds)("%s Global models lifecycle", (kind) => {
  it("cancels during preparation and rejects duplicate, late and closed-window work", async () => {
    const h = await globalProviderHarness([], true);
    const pending = h.send("provider:models", payload(kind), "window", "old");
    await h.send("provider:models-cancel", { modelRequestId: "old" }, "window", "cancel");
    await h.send("provider:models-cancel", { modelRequestId: "late" }, "window", "cancel-late");
    h.ready.releaseNext();
    await pending;
    await h.send("provider:models", payload(kind), "window", "old");
    await h.send("provider:models", payload(kind), "window", "late");
    await h.send("provider:models-cancel", {}, "window", "close");
    await h.send("provider:models", payload(kind), "window", "after-close");
    expect(h.transport.calls).toHaveLength(0);
    expect(h.replies).toHaveLength(0);
  });
  it("suppresses old success while new and other-window work remain active", async () => {
    const h = await globalProviderHarness();
    const old = h.send("provider:models", payload(kind), "window", "old");
    await h.transport.responses.waitForPending();
    const firstJob = h.transport.calls[0]!.jobId;
    const next = h.send("provider:models", payload(kind), "window", "next");
    const other = h.send("provider:models", payload(kind), "other", "old");
    await h.transport.responses.waitForPending(3);
    await h.send("provider:models-cancel", { modelRequestId: "old" }, "window", "cancel");
    h.transport.responses.releaseNext(response(kind));
    h.transport.responses.releaseNext(response(kind));
    h.transport.responses.releaseNext(response(kind));
    await Promise.all([old, next, other]);
    expect(h.transport.cancelled).toEqual([firstJob]);
    expect(
      h.replies
        .filter((reply) => reply.name === "provider:models-result")
        .map((reply) => [reply.sender, reply.data.requestId]),
    ).toEqual([
      ["window", "next"],
      ["other", "old"],
    ]);
  });
  it("uses the mailbox close path even without a Sidebar unload", async () => {
    const h = await globalProviderHarness();
    const work = h.send("provider:models", payload(kind));
    await h.transport.responses.waitForPending();
    h.close("window");
    h.transport.responses.releaseNext(response(kind));
    await work;
    expect(h.transport.cancelled).toHaveLength(1);
    expect(h.replies).toHaveLength(0);
  });
});

for (const kind of kinds) {
  it(`${kind} suppresses a credential-epoch response while cancellation is still pending`, async () => {
    const { ProviderProfiles } = await import("../../src/providers/profiles.js");
    const store = new ProviderProfiles(() => "10000000-0000-4000-8000-000000000001");
    const profile = store.save({
      kind,
      endpoint: "https://fixture.test",
      model: "model",
      displayName: "Profile",
      proxyMode: "direct",
    });
    const h = await globalProviderHarness([profile]);
    const input = {
      ...payload(kind),
      profileId: profile.profileId,
      profileRevision: profile.revision,
      endpointFingerprint: profile.endpointFingerprint,
    };
    const old = h.send("provider:models", input, "window", "old");
    await h.transport.responses.waitForPending();
    h.transport.holdCancellation = true;
    const mutation = h.save(
      { ...profile, expectedRevision: profile.revision },
      "synthetic-new-key",
      "other",
    );
    await h.transport.cancellations.waitForPending();
    const latest = h.profiles.get(profile.profileId)!;
    const next = h.send(
      "provider:models",
      {
        ...input,
        profileRevision: latest.revision,
        endpointFingerprint: latest.endpointFingerprint,
      },
      "window",
      "next",
    );
    await h.transport.responses.waitForPending(2);
    h.transport.responses.releaseNext(response(kind));
    h.transport.responses.releaseNext(response(kind));
    await Promise.all([old, next]);
    expect(h.transport.cancelled).toEqual([h.transport.calls[0]!.jobId]);
    expect(
      h.replies
        .filter((reply) => reply.name === "provider:models-result")
        .map((reply) => reply.data.requestId),
    ).toEqual(["next"]);
    h.transport.cancellations.releaseNext();
    await mutation;
    await h.send("provider:models-cancel", { modelRequestId: "old" }, "window", "late");
    expect(h.transport.cancelled).toHaveLength(1);
  });
}
