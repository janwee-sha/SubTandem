import { describe, expect, it } from "vitest";
import vectors from "../fixtures/credentials/channel-vectors.json";
import { credentialRelayHarness } from "../helpers/credential-channel-harness.js";

const open = {
  protocolVersion: 2,
  sidebarInstanceId: vectors.offer.sidebarInstanceId,
  drawerId: vectors.offer.drawerId,
  sourceProfile: vectors.offer.sourceProfile,
  clientPublicKey: vectors.offer.clientPublicKey,
};
const request = (payload: unknown) => ({ requestId: "open-request", revision: 1, payload });
const tick = async () => {
  await Promise.resolve();
  await Promise.resolve();
};

describe("production Main/Global credential relay", () => {
  it("strips a forged sender before Main forwards the public handshake", () => {
    const h = credentialRelayHarness();
    expect(h.sidebarHandlers.has("credential-channel:open")).toBe(true);
    h.sidebarHandlers.get("credential-channel:open")!(request({ ...open, senderId: "forged" }));
    expect(h.forwarded).toEqual([{ name: "credential-channel:open", data: request(open) }]);
  });
  it("binds real sender, registers before awaiting, and delivers only to that window", async () => {
    const h = credentialRelayHarness();
    const pending = h.relay.receive("real-window", "credential-channel:open", request(open));
    expect(h.authorizations.pendingCount).toBe(1);
    h.authorizations.releaseNext();
    await tick();
    expect(h.calls.pendingInputs[0]).toEqual({
      action: "open",
      payload: { ...open, senderId: "real-window" },
    });
    h.calls.releaseNext({ ...vectors.offer, senderId: "real-window" });
    await pending;
    expect(h.replies).toHaveLength(1);
    expect(h.replies[0]!.senderId).toBe("real-window");
    expect(h.replies[0]!.data.ok).toBe(true);
    expect(JSON.stringify(h.calls.pendingInputs)).not.toContain("apiKey");
  });
  it("revokes the owner even when closed before the first await completes", async () => {
    const h = credentialRelayHarness();
    const pending = h.relay.receive("real-window", "credential-channel:open", request(open));
    expect(h.authorizations.pendingCount).toBe(1);
    h.relay.close("real-window");
    h.authorizations.releaseNext();
    await pending;
    expect(h.calls.pendingInputs.every((call) => call.action === "close")).toBe(true);
    expect(h.replies).toEqual([]);
  });
  it("rejects old helper negotiation and failed authentication with a fixed error", async () => {
    const h = credentialRelayHarness();
    const pending = h.relay.receive("real-window", "credential-channel:open", request(open));
    expect(h.authorizations.pendingCount).toBe(1);
    h.authorizations.releaseNext();
    await tick();
    h.calls.releaseNext({ ...vectors.offer, senderId: "real-window", protocolVersion: 1 });
    await pending;
    expect(h.replies[0]!.data).toMatchObject({
      ok: false,
      error: "credential-channel-unavailable",
    });
    expect(JSON.stringify(h.replies)).not.toContain("clientPublicKey");
  });
});

it("forwards an authenticated handshake failure only to its owner and revokes the channel", async () => {
  const h = credentialRelayHarness();
  const opening = h.relay.receive("real-window", "credential-channel:open", request(open));
  h.authorizations.releaseNext();
  await tick();
  h.calls.releaseNext({ ...vectors.offer, senderId: "real-window" });
  await opening;
  const confirming = h.relay.receive("real-window", "credential-channel:confirm", {
    requestId: "confirmation",
    revision: 1,
    payload: {
      protocolVersion: 2,
      channelId: vectors.offer.channelId,
      helperSessionId: vectors.offer.helperSessionId,
      sequence: 0,
      sealedPayload: vectors.vectors[0]!.handshakeSealed,
    },
  });
  expect(h.calls.pendingInputs[0]!.action).toBe("confirm");
  h.calls.rejectNext(new Error("synthetic-private-upstream-detail"));
  await confirming;
  expect(h.replies.at(-1)).toMatchObject({
    senderId: "real-window",
    data: { requestId: "confirmation", ok: false, error: "credential-channel-unavailable" },
  });
  expect(JSON.stringify(h.replies)).not.toContain("synthetic-private-upstream-detail");
  expect(h.calls.pendingInputs.some((call) => call.action === "close")).toBe(true);
});
