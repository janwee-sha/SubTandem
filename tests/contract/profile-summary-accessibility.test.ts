import { describe, expect, it } from "vitest";
import { sidebarHarness } from "../helpers/sidebar-harness.js";

describe("Profile summary accessibility", () => {
  it("describes only truncated full text while keeping Disclosure and switch names separate", () => {
    const h = sidebarHarness();
    const profile = {
      profileId: "accessible",
      revision: 1,
      endpointFingerprint: "fingerprint",
      displayName: "<Name & Co>",
      kind: "claude",
      endpoint: "https://example.test/?a=1&b=<value>",
      model: "<long-model>&",
      proxyMode: "system",
      credentialConfigured: true,
    };
    h.receive("state:update", { profiles: [profile] });
    const row = h.evaluate('profileRows.get("accessible")');
    const disclosure = row.querySelector(".profile-disclosure");
    const activation = row.querySelector(".profile-activation input");
    expect(disclosure.getAttribute("aria-label")).toBe("Edit <Name & Co>");
    expect(activation.getAttribute("aria-label")).toBe("Enable <Name & Co>");
    expect(disclosure.getAttribute("aria-describedby")).toBeNull();

    h.resize(row.querySelector("strong"), 100, 200);
    h.resize(row.querySelector(".profile-summary"), 100, 200);
    h.resize(row.querySelector("code"), 100, 200);
    const description = disclosure.children.find((child: { className: string }) =>
      child.className.includes("profile-overflow-description"),
    );
    expect(description?.id).toBe(disclosure.getAttribute("aria-describedby"));
    expect(description?.textContent).toContain("Name: <Name & Co>");
    expect(description?.textContent).toContain("Service and model: Claude · <long-model>&");
    expect(description?.textContent).toContain("API root: https://example.test/?a=1&b=<value>");
    expect(description?.textContent).not.toMatch(/macOS proxy|key saved|secret-key/);
    expect(activation.getAttribute("aria-describedby")).toBeNull();

    for (const line of [
      row.querySelector("strong"),
      row.querySelector(".profile-summary"),
      row.querySelector("code"),
    ])
      h.resize(line, 250, 100);
    expect(disclosure.getAttribute("aria-describedby")).toBeNull();
    expect(description?.textContent).toBe("");
  });
});
