import { describe, expect, it } from "vitest";
import { sidebarHarness } from "../helpers/sidebar-harness.js";
function ready(h: ReturnType<typeof sidebarHarness>, profiles: any[] = [], ready = true) {
  h.receive("state:update", {
    profiles,
    profileAuthority: {
      authorityId: "authority",
      stateVersion: h.evaluate("sidebarState.snapshot.profileAuthority?.stateVersion ?? 0") + 1,
      activationGeneration: 1,
      ready,
      activation: null,
      profiles,
    },
  });
}
describe("confirmed empty profile list", () => {
  it("requires ready authority and hides the hint during a new drawer", () => {
    const h = sidebarHarness();
    h.evaluate("renderProfiles([])");
    expect(h.element("#profiles").dataset.empty).not.toBe("true");
    ready(h);
    expect(h.element("#profiles").dataset.empty).toBe("true");
    expect(h.element("#profiles").children.find((c) => c.className === "empty")?.textContent).toBe(
      "No profiles yet.",
    );
    h.element("#new-profile").dispatch("click");
    expect(h.element("#profiles").dataset.empty).toBe("false");
    h.element("#cancel-profile").dispatch("click");
    expect(h.element("#profiles").dataset.empty).toBe("true");
  });
  it("separates unavailable storage from an empty list", () => {
    const h = sidebarHarness();
    ready(h, [], false);
    expect(h.element("#profiles").dataset.empty).toBe("false");
    expect(h.element("#profiles").children.some((c) => c.className === "empty")).toBe(false);
    expect(
      h.element("#profiles").children.some((c) => c.className.includes("profile-storage-status")),
    ).toBe(true);
  });
  it("shows only real profiles then returns to empty after confirmed removal", () => {
    const h = sidebarHarness();
    const p = {
      profileId: "one",
      revision: 1,
      kind: "openai",
      displayName: "One",
      endpoint: "https://api.openai.com/v1",
      credentialConfigured: false,
    };
    ready(h, [p]);
    expect(h.element("#profiles").dataset.empty).toBe("false");
    ready(h);
    expect(h.element("#profiles").dataset.empty).toBe("true");
  });
});
