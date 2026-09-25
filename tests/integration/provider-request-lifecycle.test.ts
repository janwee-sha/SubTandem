import { expect, it } from "vitest";
import { globalProviderHarness } from "../helpers/global-provider-harness.js";
import { ProviderProfiles } from "../../src/providers/profiles.js";
import { ProviderBroker } from "../../src/providers/broker.js";
import {
  CompletionQueue,
  activateTestProfile,
  createTestProfileAuthority,
  authorizedProviderRequest,
} from "../helpers/profile-activation-harness.js";
import { makeProviderRequest } from "../contract/provider-test-helpers.js";
import { endingResponse } from "../helpers/provider-failure-contract.js";
import type { TranslationProvider } from "../../src/providers/provider.js";
const flush = async () => {
  for (let i = 0; i < 25; i++) await Promise.resolve();
};
for (const kind of ["openai", "deepseek", "claude", "ollama"] as const) {
  const profiles = new ProviderProfiles(() => "saved");
  const profile = profiles.save({
    kind,
    endpoint: "https://fixture.test",
    model: "model",
    displayName: "Profile",
    capability: "strict-json-schema",
  });
  const request = {
    ...makeProviderRequest(),
    profileId: profile.profileId as any,
    profileRevision: profile.revision,
    endpointFingerprint: profile.endpointFingerprint as any,
    authorityId: "test-authority",
    activationGeneration: 1,
  };
  it(`${kind} cancels Global preparation without waiting for restoration`, async () => {
    const h = await globalProviderHarness([profile], true, true);
    const work = h.send("provider:attempt", request);
    let completed = false;
    const cancel = h.send("provider:cancel", { requestId: "request" }).then(() => {
      completed = true;
    });
    await flush();
    expect(completed).toBe(true);
    h.ready.releaseNext();
    await Promise.all([work, cancel]);
    expect(h.reads).toEqual([]);
    expect(h.transport.calls).toEqual([]);
    expect(h.replies.filter((reply) => reply.name.startsWith("provider:attempt"))).toEqual([]);
  });
  it(`${kind} closes a window during Key preparation and never sends the returned Key`, async () => {
    const h = await globalProviderHarness([profile], false, true);
    await flush();
    const work = h.send("provider:attempt", request);
    await h.secrets.waitForPending();
    h.close("window");
    h.secrets.releaseNext({ apiKey: "old-key" });
    await work;
    expect(h.transport.calls).toEqual([]);
    expect(h.replies.filter((reply) => reply.name.startsWith("provider:attempt"))).toEqual([]);
  });
  it(`${kind} leaves active translation intact when only its drawer Test is cancelled`, async () => {
    const h = await globalProviderHarness([profile], false, true);
    await flush();
    const work = h.send("provider:attempt", request);
    await h.secrets.waitForPending();
    h.secrets.releaseNext(null);
    await h.transport.responses.waitForPending();
    await h.send("provider:test-cancel", { testRequestId: "test" }, "window", "cancel-test");
    await h.send("provider:models-cancel", { modelRequestId: "models" }, "window", "cancel-models");
    const count = kind === "ollama" ? 2 : 1;
    for (let i = 0; i < count; i++) {
      await h.transport.responses.waitForPending();
      const current = h.transport.responses.pendingInputs[0]!;
      const body = current.body as { messages: Array<{ content: string }> };
      const content = body.messages.at(-1)!.content;
      const targets = JSON.parse(
        kind === "ollama"
          ? content.split("INPUT_JSON_BEGIN\n")[1]!.split("\nINPUT_JSON_END")[0]!
          : content,
      ).targets as Array<{ id: string }>;
      h.transport.responses.releaseNext({
        statusCode: 200,
        headers: {},
        bodyText: JSON.stringify(
          endingResponse(
            kind,
            targets.map((target) => target.id),
            "missing",
          ),
        ),
      });
    }
    await work;
    expect(h.transport.cancelled).toEqual([]);
    expect(h.replies.filter((reply) => reply.name === "provider:attempt-result")).toHaveLength(1);
  });
}
it("Broker blocks cancelled construction, completed duplicates and closed sender work", async () => {
  const profiles = new ProviderProfiles(() => "saved");
  const profile = profiles.save({
    kind: "openai",
    endpoint: "https://fixture.test",
    model: "model",
    displayName: "Profile",
  });
  const authority = createTestProfileAuthority(profiles);
  await activateTestProfile(authority, profile);
  const queue = new CompletionQueue<void, TranslationProvider>();
  let executions = 0;
  const provider: TranslationProvider = {
    attempt: async () => {
      executions++;
      return { translations: [] };
    },
  };
  const broker = new ProviderBroker(profiles, authority, () => queue.hold().promise);
  const request = authorizedProviderRequest(authority, {
    ...makeProviderRequest(),
    profileId: profile.profileId as any,
    profileRevision: profile.revision,
    endpointFingerprint: profile.endpointFingerprint as any,
  });
  const old = broker.attempt("window", request).catch((error) => error);
  await queue.waitForPending();
  await broker.cancel("window", request.requestId);
  queue.releaseNext(provider);
  expect(await old).toMatchObject({ category: "cancelled" });
  expect(executions).toBe(0);
  await expect(broker.attempt("window", request)).rejects.toBeDefined();
  await broker.cancel("window", "early");
  await expect(
    broker.attempt("window", { ...request, requestId: "early" as any }),
  ).rejects.toBeDefined();
});
