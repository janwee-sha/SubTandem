import { afterEach, describe, expect, it, vi } from "vitest";
import { sidebarHarness } from "../helpers/sidebar-harness.js";
import { CREDENTIAL_LIMITS } from "../../shared/credential-protocol.js";

const profile = {
  profileId: "one",
  revision: 1,
  displayName: "One",
  kind: "openai",
  endpoint: "https://api.openai.com/v1",
  model: "model-a",
  proxyMode: "direct",
  endpointFingerprint: "fp",
  credentialConfigured: true,
};

async function editor(connected = true) {
  const h = sidebarHarness();
  const peer = connected ? h.connectCredentials({ readValue: "synthetic-saved-key" }) : null;
  h.receive("state:update", { profiles: [profile] });
  h.evaluate('loadEditor(profiles.get("one"))');
  await h.settleCredentials();
  return { h, peer };
}

afterEach(() => vi.restoreAllMocks());

describe("production Profile Test deadline", () => {
  it("uses a ten-second click deadline and renews the channel for a successful explicit retry", async () => {
    const { h, peer } = await editor();
    const now = Date.now();
    const clock = vi.spyOn(Date, "now").mockReturnValue(now);
    h.element("#test-profile").dispatch("click");
    await h.settleCredentials();
    const first = h.messages.findLast((m) => m.name === "provider:draft-test")!;
    expect(first.data.payload.frame.context.expiresAtMs).toBe(now + 10_000);
    clock.mockReturnValue(now + 9_999);
    h.pulse();
    expect(h.element("#test-profile").disabled).toBe(true);
    clock.mockReturnValue(now + 10_000);
    h.pulse();
    expect(h.element("#profile-test-status").textContent).toContain("timed out");
    expect(h.element("#test-profile").disabled).toBe(false);
    expect(h.messages.filter((m) => m.name === "provider:draft-test")).toHaveLength(1);
    h.element("#test-profile").dispatch("click");
    await h.settleCredentials();
    const second = h.messages.findLast((m) => m.name === "provider:draft-test")!;
    expect(second.data.requestId).not.toBe(first.data.requestId);
    expect(second.data.payload.frame.channelId).not.toBe(first.data.payload.frame.channelId);
    expect(peer!.open(second.data)).toBe("synthetic-saved-key");
    h.receive("provider:test-result", {
      requestId: first.data.requestId,
      drawerId: first.data.payload.drawerId,
      draftRevision: first.data.payload.frame.context.draftRevision,
      ok: true,
    });
    expect(h.element("#profile-test-status").textContent).toBe("Testing…");
    h.receive("provider:test-result", {
      requestId: second.data.requestId,
      drawerId: second.data.payload.drawerId,
      draftRevision: second.data.payload.frame.context.draftRevision,
      ok: true,
    });
    clock.mockReturnValue(now + 20_001);
    h.pulse();
    h.flush();
    expect(h.element("#profile-test-status").textContent).toBe("Test passed");
    expect(h.element("#test-profile").disabled).toBe(false);
  });

  it("expires on the first resumed Sidebar heartbeat even when its timeout has not fired", async () => {
    const { h } = await editor();
    const now = Date.now();
    const clock = vi.spyOn(Date, "now").mockReturnValue(now);
    h.element("#test-profile").dispatch("click");
    await h.settleCredentials();
    clock.mockReturnValue(now + 300_001);
    h.pulse();
    expect(h.element("#test-profile").disabled).toBe(false);
    expect(h.element("#profile-test-status").textContent).toContain("timed out");
    expect(h.messages.filter((m) => m.name === "provider:test-cancel")).toHaveLength(1);
    h.flush();
    expect(h.messages.filter((m) => m.name === "provider:test-cancel")).toHaveLength(1);
  });

  it("clears the deadline when editing invalidates the current Test", async () => {
    const { h } = await editor();
    const now = Date.now();
    const clock = vi.spyOn(Date, "now").mockReturnValue(now);
    h.element("#test-profile").dispatch("click");
    await h.settleCredentials();
    h.element("#provider-key").value = "synthetic-edited-key";
    h.element("#provider-key").dispatch("input");
    clock.mockReturnValue(now + 10_001);
    h.pulse();
    h.flush();
    expect(h.element("#profile-test-status").textContent).toBe("");
    expect(h.element("#test-profile").disabled).toBe(false);
    expect(h.messages.filter((m) => m.name === "provider:test-cancel")).toHaveLength(1);
  });

  it("ends a missing result at the click deadline and ignores a late success", async () => {
    const { h } = await editor();
    const now = Date.now();
    const clock = vi.spyOn(Date, "now").mockReturnValue(now);
    h.element("#test-profile").dispatch("click");
    await h.settleCredentials();
    const operation = h.messages.findLast((m) => m.name === "provider:draft-test")!;
    clock.mockReturnValue(now + 10_001);
    h.flush();
    expect(h.element("#test-profile").disabled).toBe(false);
    expect(h.element("#profile-test-status").textContent).toContain("timed out");
    expect(
      h.messages.findLast((m) => m.name === "provider:test-cancel")?.data.payload.testRequestId,
    ).toBe(operation.data.requestId);
    h.receive("provider:test-result", {
      requestId: operation.data.requestId,
      drawerId: operation.data.payload.drawerId,
      draftRevision: operation.data.payload.frame.context.draftRevision,
      ok: true,
    });
    expect(h.element("#profile-test-status").textContent).toContain("timed out");
  });

  it("bounds a stalled handshake and can start a new Test after timeout", async () => {
    const { h } = await editor(false);
    const now = Date.now();
    const clock = vi.spyOn(Date, "now").mockReturnValue(now);
    h.element("#test-profile").dispatch("click");
    clock.mockReturnValue(now + 10_001);
    h.flush();
    await h.settleCredentials();
    expect(h.element("#test-profile").disabled).toBe(false);
    expect(h.element("#profile-test-status").textContent).toContain("timed out");
    h.connectCredentials();
    h.element("#test-profile").dispatch("click");
    await h.settleCredentials();
    expect(h.messages.filter((m) => m.name === "provider:draft-test")).toHaveLength(1);
  });

  it("renews an idle channel for the current input without replaying an earlier Test", async () => {
    const { h, peer } = await editor();
    const now = Date.now();
    vi.spyOn(Date, "now").mockReturnValue(now + CREDENTIAL_LIMITS.idleMs + 1);
    h.element("#provider-key").value = "synthetic-current-key";
    h.element("#provider-key").dispatch("input");
    h.element("#test-profile").dispatch("click");
    await h.settleCredentials();
    const operation = h.messages.findLast((m) => m.name === "provider:draft-test")!;
    expect(operation).toBeDefined();
    expect(h.messages.filter((m) => m.name === "credential-channel:open")).toHaveLength(2);
    expect(peer!.open(operation.data)).toBe("synthetic-current-key");
    expect(h.messages.filter((m) => m.name === "provider:draft-test")).toHaveLength(1);
  });

  it("releases a rejected channel only for the current Test and permits a fresh click", async () => {
    const { h } = await editor();
    h.element("#test-profile").dispatch("click");
    await h.settleCredentials();
    const operation = h.messages.findLast((m) => m.name === "provider:draft-test")!;
    h.receive("provider:test-result", {
      requestId: operation.data.requestId,
      drawerId: operation.data.payload.drawerId,
      draftRevision: operation.data.payload.frame.context.draftRevision,
      ok: false,
      code: "TEST_INVALIDATED",
    });
    h.element("#test-profile").dispatch("click");
    await h.settleCredentials();
    expect(h.messages.filter((m) => m.name === "credential-channel:open")).toHaveLength(2);
    const current = h.messages.findLast((m) => m.name === "provider:draft-test")!;
    expect(current.data.requestId).not.toBe(operation.data.requestId);
    h.receive("provider:test-result", {
      requestId: operation.data.requestId,
      drawerId: operation.data.payload.drawerId,
      draftRevision: operation.data.payload.frame.context.draftRevision,
      ok: true,
    });
    expect(h.element("#profile-test-status").textContent).toBe("Testing…");
    h.receive("provider:test-result", {
      requestId: current.data.requestId,
      drawerId: current.data.payload.drawerId,
      draftRevision: current.data.payload.frame.context.draftRevision,
      ok: true,
    });
    vi.spyOn(Date, "now").mockReturnValue(Date.now() + 10_001);
    h.flush();
    expect(h.element("#profile-test-status").textContent).toBe("Test passed");
  });
});
