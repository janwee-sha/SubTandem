import { beforeAll, describe, expect, it } from "vitest";
beforeAll(async () => {
  await import("../../ui/sidebar-state.js");
});
function editor() {
  const state = globalThis.createSubTandemSidebarState([
    { profileId: "one", revision: 2, endpointFingerprint: "fp", credentialConfigured: true },
  ]);
  state.openProfileDrawer("one");
  return state;
}
describe("credential read ownership", () => {
  it("accepts only the current channel and frozen drawer context once", () => {
    const state = editor();
    const owner = state.beginCredentialRead("channel-one")!;
    expect(state.acceptCredentialRead(owner, "channel-two")).toBe(false);
    expect(state.acceptCredentialRead(owner, "channel-one")).toBe(true);
    expect(state.acceptCredentialRead(owner, "channel-one")).toBe(false);
  });
  it.each(["input", "clear", "field", "save", "close", "revision", "delete"])(
    "rejects a late read after %s",
    (action) => {
      const state = editor();
      const owner = state.beginCredentialRead("one")!;
      if (action === "input" || action === "clear") state.changeDrawerCredential();
      if (action === "clear") state.changeDrawerCredential();
      if (action === "field") state.changeDrawerTestField();
      if (action === "save") state.beginProfileSave("save");
      if (action === "close") state.closeProfileDrawer();
      if (action === "revision") state.applyProfiles([{ profileId: "one", revision: 3 }]);
      if (action === "delete") state.applyProfiles([]);
      expect(state.acceptCredentialRead(owner, "one")).toBe(false);
    },
  );
  it("keeps configured and secrets out of read state", () => {
    const state = editor();
    state.beginCredentialRead("one");
    expect(state.snapshot.profiles[0].credentialConfigured).toBe(true);
    expect(JSON.stringify(state.snapshot)).not.toContain("channelId");
    expect(state.snapshot.drawer.masked).toBe(true);
    state.setDrawerMasked(false);
    state.closeProfileDrawer();
    expect(state.snapshot.drawer.masked).toBe(true);
  });
});
