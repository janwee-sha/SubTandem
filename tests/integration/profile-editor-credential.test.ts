import { afterEach, describe, expect, it, vi } from "vitest";
import { sidebarHarness } from "../helpers/sidebar-harness.js";
const profile = {
  profileId: "one",
  revision: 1,
  displayName: "One",
  kind: "openai",
  endpoint: "https://api.openai.com",
  model: "model-a",
  proxyMode: "direct",
  endpointFingerprint: "fp",
  credentialConfigured: true,
};
afterEach(() => vi.useRealTimers());
describe.each(["openai", "claude", "deepseek", "ollama"])("%s encrypted editor read", (kind) => {
  function editor(failRead = false) {
    const h = sidebarHarness();
    const peer = h.connectCredentials({
      readValue: "synthetic-readable-key",
      deferRead: true,
      failRead,
    });
    h.receive("state:update", { profiles: [{ ...profile, kind }] });
    h.evaluate('loadEditor(profiles.get("one"))');
    return { h, peer };
  }
  it("fills masked only after the authenticated read without requests or visible loading", async () => {
    const { h } = editor();
    await h.settleCredentials();
    const key = h.element("#provider-key");
    expect(key.value).toBe("");
    expect(h.element("#save-profile").disabled).toBe(true);
    expect(h.element("#test-profile").disabled).toBe(true);
    expect(h.element("#refresh-models").disabled).toBe(true);
    expect(h.element("#cancel-profile").disabled).toBe(false);
    expect(h.element("#delete-profile").disabled).toBe(false);
    expect(h.element("#profile-editor-status").textContent).toBe("");
    h.releaseCredentialReads();
    await h.settleCredentials();
    expect(key.value).toBe("synthetic-readable-key");
    expect(key.type).toBe("password");
    expect(h.element("#save-profile").disabled).toBe(false);
    const refreshed = h.credentialTimeline.filter((entry) => entry.name === "provider:models");
    expect(refreshed).toEqual([
      expect.objectContaining({ key: "synthetic-readable-key", masked: true, disabled: false }),
    ]);
    expect(
      h.messages.filter((m) =>
        [
          "provider:models",
          "provider:draft-models",
          "provider:test",
          "provider:draft-test",
        ].includes(m.name),
      ),
    ).toHaveLength(1);
    expect(
      h.evaluate("JSON.stringify(sidebarState.snapshot)+JSON.stringify(providerDrafts)"),
    ).not.toContain("synthetic-readable-key");
  });
  it.each(["open", "confirm", "read"] as const)(
    "guards all business entries during %s and never queues manual actions",
    async (phase) => {
      const h = sidebarHarness();
      h.connectCredentials({ readValue: "synthetic-readable-key", deferPhases: [phase] });
      h.receive("state:update", { profiles: [{ ...profile, kind }] });
      h.evaluate('loadEditor(profiles.get("one"))');
      await h.settleCredentials();
      for (const id of ["#refresh-models", "#test-profile", "#save-profile"]) {
        expect(h.element(id).disabled).toBe(true);
        for (const input of ["mouse", "Enter", "Space"] as const) h.activate(id, input);
        h.element(id).dispatch("click");
        h.element(id).dispatch("click");
      }
      h.evaluate('requestModels("manual")');
      await h.settleCredentials();
      const operations = () =>
        h.messages.filter((entry) =>
          [
            "provider:models",
            "provider:draft-models",
            "provider:draft-test",
            "profile:save-prepare",
          ].includes(entry.name),
        );
      expect(operations()).toHaveLength(0);
      h.releaseCredentialPhase(phase);
      await h.settleCredentials();
      expect(operations().map((entry) => entry.name)).toEqual(["provider:models"]);
    },
  );
  it("short circuits a confirmed absent key and never reads new profiles", async () => {
    const h = sidebarHarness();
    h.connectCredentials();
    h.receive("state:update", { profiles: [{ ...profile, kind, credentialConfigured: false }] });
    h.evaluate('loadEditor(profiles.get("one"))');
    expect(h.element("#save-profile").disabled).toBe(false);
    expect(h.messages.some((entry) => entry.name === "credential-channel:open")).toBe(false);
    h.evaluate("openNewProfile()");
    expect(h.element("#save-profile").disabled).toBe(false);
  });
  it("coalesces field triggers and waits for the last endpoint debounce", async () => {
    vi.useFakeTimers();
    const h = sidebarHarness({ timers: globalThis });
    h.connectCredentials({ readValue: "synthetic-readable-key", deferRead: true });
    h.receive("state:update", { profiles: [{ ...profile, kind }] });
    h.evaluate('loadEditor(profiles.get("one"))');
    await h.settleCredentials();
    h.element("#provider-endpoint").value = "https://latest.test";
    h.element("#provider-endpoint").dispatch("input");
    h.element("#provider-proxy-mode").dispatch("change");
    vi.advanceTimersByTime(200);
    h.releaseCredentialReads();
    await h.settleCredentials();
    expect(h.messages.filter((entry) => entry.name === "provider:models")).toHaveLength(0);
    vi.advanceTimersByTime(200);
    await h.settleCredentials();
    const requests = h.messages.filter((entry) => entry.name === "provider:models");
    expect(requests).toHaveLength(1);
    expect(requests[0]!.data.payload.endpoint).toBe("https://latest.test");
    expect(h.element("#provider-key").value).toBe("");
  });
  it.each(["open", "confirm", "read"] as const)(
    "uses one 15 second deadline through %s and rejects late results",
    async (phase) => {
      vi.useFakeTimers();
      const h = sidebarHarness({ timers: globalThis });
      h.connectCredentials({ readValue: "synthetic-expired-key", deferPhases: [phase] });
      h.receive("state:update", { profiles: [{ ...profile, kind }] });
      h.evaluate('loadEditor(profiles.get("one"))');
      await h.settleCredentials();
      h.element("#provider-key").value = "current-key";
      h.element("#provider-key").dispatch("input");
      vi.advanceTimersByTime(15_000);
      await h.settleCredentials();
      expect(h.element("#save-profile").disabled).toBe(false);
      expect(h.element("#provider-key").value).toBe("current-key");
      const requests = h.messages.filter((entry) => entry.name === "provider:models").length;
      h.releaseCredentialPhase(phase);
      await h.settleCredentials();
      expect(h.messages.filter((entry) => entry.name === "provider:models")).toHaveLength(requests);
      expect(h.element("#provider-key").value).toBe("current-key");
      expect(h.element("#profile-editor-status").textContent).toBe("");
      h.event("pagehide");
    },
  );
  it("reopening prevents the old finally from unlocking or closing the new read", async () => {
    const { h } = editor();
    await h.settleCredentials();
    const old = h.evaluate("sidebarState.snapshot.credentialLoad.loadId");
    h.evaluate('loadEditor(profiles.get("one")); loadEditor(profiles.get("one"))');
    await h.settleCredentials();
    expect(h.evaluate("sidebarState.snapshot.credentialLoad.loadId")).not.toBe(old);
    expect(h.element("#save-profile").disabled).toBe(true);
    h.releaseCredentialReads();
    await h.settleCredentials();
    expect(h.element("#provider-key").value).toBe("synthetic-readable-key");
    expect(h.element("#save-profile").disabled).toBe(false);
  });
  it.each(["input", "clear", "save", "cancel", "revision"])(
    "discards a delayed value after %s",
    async (action) => {
      const { h } = editor();
      await h.settleCredentials();
      const key = h.element("#provider-key");
      if (action === "input" || action === "clear") {
        key.value = "current-synthetic";
        key.dispatch("input");
      }
      if (action === "clear") {
        key.value = "";
        key.dispatch("input");
      }
      if (action === "save") h.evaluate('sidebarState.beginProfileSave("save")');
      if (action === "cancel") h.element("#cancel-profile").dispatch("click");
      if (action === "revision")
        h.receive("state:update", { profiles: [{ ...profile, kind, revision: 2 }] });
      h.releaseCredentialReads();
      await h.settleCredentials();
      expect(key.value).toBe(action === "input" ? "current-synthetic" : "");
    },
  );
  it("fails silently and seals the current empty draft without falling back to saved", async () => {
    const { h, peer } = editor(true);
    await h.settleCredentials();
    h.releaseCredentialReads();
    await h.settleCredentials();
    expect(h.element("#provider-key").value).toBe("");
    expect(h.evaluate('profiles.get("one").credentialConfigured')).toBe(true);
    expect(h.element("#profile-editor-status").textContent).toBe("");
    h.element("#test-profile").dispatch("click");
    await h.settleCredentials();
    const m = h.messages.findLast((m) => m.name === "provider:draft-test")!;
    expect(peer.open(m.data)).toBe("");
  });
});
