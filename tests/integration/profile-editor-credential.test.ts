import { describe, expect, it } from "vitest";
import { sidebarHarness } from "../helpers/sidebar-harness.js";
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
    expect(h.element("#save-profile").disabled).toBe(false);
    expect(h.element("#profile-editor-status").textContent).toBe("");
    h.releaseCredentialReads();
    await h.settleCredentials();
    expect(key.value).toBe("synthetic-readable-key");
    expect(key.type).toBe("password");
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
