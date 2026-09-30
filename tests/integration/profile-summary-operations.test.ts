import { describe, expect, it } from "vitest";
import { sidebarHarness } from "../helpers/sidebar-harness.js";

const saved = {
  profileId: "saved",
  revision: 1,
  endpointFingerprint: "fingerprint",
  displayName: "Saved profile",
  kind: "openai",
  endpoint: "https://example.test/v1",
  model: "model-one",
  proxyMode: "direct",
  credentialConfigured: true,
};

describe("Profile summary operations", () => {
  it("follows saved revisions through expansion, collapse, activation and removal", () => {
    const h = sidebarHarness();
    const authority = {
      authorityId: "profiles",
      stateVersion: 1,
      ready: true,
      activationGeneration: 0,
      activation: null,
      profiles: [saved],
    };
    h.receive("state:update", { profileAuthority: authority, profiles: [saved] });
    const row = h.evaluate('profileRows.get("saved")');
    expect(row.querySelector(".profile-summary").textContent).toBe("OpenAI · model-one");
    expect(row.querySelector("code").textContent).toBe(saved.endpoint);

    h.evaluate(`loadEditor(${JSON.stringify(saved)})`);
    expect(row.querySelector(".profile-disclosure").getAttribute("aria-expanded")).toBe("true");
    expect(h.element("#provider-proxy-mode").value).toBe("direct");
    expect(h.element("#provider-key").placeholder).toBe("Optional");
    expect(row.querySelector(".profile-summary").textContent).toBe("OpenAI · model-one");

    h.evaluate("clearProfileDrawer(false)");
    expect(row.querySelector(".profile-disclosure").getAttribute("aria-expanded")).toBe("false");

    const updated = {
      ...saved,
      revision: 2,
      model: "model-two",
      endpoint: "https://updated.example/v1",
      proxyMode: "system",
      credentialConfigured: false,
    };
    h.receive("state:update", {
      profileAuthority: { ...authority, stateVersion: 2, profiles: [updated] },
      profiles: [updated],
    });
    expect(row.querySelector(".profile-summary").textContent).toBe("OpenAI · model-two");
    expect(row.querySelector("code").textContent).toBe(updated.endpoint);
    h.evaluate(`loadEditor(${JSON.stringify(updated)})`);
    expect(h.element("#provider-proxy-mode").value).toBe("system");
    expect(h.element("#provider-key").placeholder).toBe("Optional");

    const activation = row.querySelector(".profile-activation input");
    expect(activation.dataset.profileId).toBe("saved");
    expect(activation.getAttribute("aria-label")).toBe("Enable Saved profile");
    activation.checked = true;
    h.element("#profiles").dispatch("change", activation);
    expect(h.messages.at(-1)).toMatchObject({
      name: "profile-activation:set",
      data: { payload: { profileId: "saved", profileRevision: 2, enabled: true } },
    });
    h.receive("state:update", { profiles: [] });
    expect(h.evaluate('profileRows.has("saved")')).toBe(false);
  });
});
