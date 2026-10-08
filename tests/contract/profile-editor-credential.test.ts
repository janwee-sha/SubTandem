import { describe, expect, it } from "vitest";
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
function editor() {
  const h = sidebarHarness();
  h.receive("state:update", { profiles: [profile] });
  h.evaluate('loadEditor(profiles.get("one"))');
  return h;
}
describe("credential visibility DOM", () => {
  it("opens a saved Profile through an accessibility click", () => {
    const h = sidebarHarness();
    h.receive("state:update", { profiles: [profile] });
    const disclosure = h.evaluate('profileRows.get("one").querySelector(".profile-disclosure")');
    h.element("#profiles").dispatch("click", disclosure, { detail: 0 });
    expect(h.evaluate("sidebarState.snapshot.drawer.mode")).toBe("editing");
    expect(h.evaluate("sidebarState.snapshot.drawer.profileId")).toBe("one");
  });
  it("disables an empty button and uses one input with stable selection and scroll", () => {
    const h = editor(),
      input = h.element("#provider-key"),
      button = h.element("#toggle-provider-key");
    expect(button.disabled).toBe(true);
    input.value = "synthetic-ui-secret";
    input.dispatch("input");
    input.focus();
    input.setSelectionRange(2, 8, "backward");
    input.scrollLeft = 37;
    button.dispatch("pointerdown");
    button.dispatch("click");
    expect(h.element("#provider-key")).toBe(input);
    expect(input.type).toBe("text");
    expect(input.selectionStart).toBe(2);
    expect(input.selectionEnd).toBe(8);
    expect(input.selectionDirection).toBe("backward");
    expect(input.scrollLeft).toBe(37);
    expect(button.getAttribute("aria-label")).toBe("Hide API key");
    expect(h.evaluate("document.activeElement === providerKey")).toBe(true);
    button.focus();
    button.dispatch("click");
    expect(input.type).toBe("password");
    expect(
      h.evaluate('document.activeElement === document.querySelector("#toggle-provider-key")'),
    ).toBe(true);
    expect(
      h.messages.filter((m) =>
        [
          "provider:models",
          "provider:draft-models",
          "provider:test",
          "provider:draft-test",
        ].includes(m.name),
      ).length,
    ).toBe(0);
  });
  it("resets visibility and input on cancel, with no credential success text", () => {
    const h = editor(),
      input = h.element("#provider-key");
    input.value = "synthetic-unsaved";
    input.dispatch("input");
    h.element("#toggle-provider-key").dispatch("click");
    h.element("#cancel-profile").dispatch("click");
    expect(input.value).toBe("");
    expect(input.type).toBe("password");
    expect(h.element("#profile-editor-status").textContent).toBe("");
  });
});
