import { describe, expect, it } from "vitest";
import { sidebarHarness } from "../helpers/sidebar-harness.js";

const profile = {
  profileId: "overflow",
  revision: 1,
  endpointFingerprint: "fingerprint",
  displayName: "Long profile name",
  kind: "openai",
  endpoint: "https://very-long.example.test/v1",
  model: "long-model-name",
  proxyMode: "direct",
  credentialConfigured: true,
};

describe("Profile line truncation", () => {
  it("adds each native title only while that line overflows", () => {
    const h = sidebarHarness();
    h.receive("state:update", { profiles: [profile] });
    const row = h.evaluate('profileRows.get("overflow")');
    const lines = [
      row.querySelector("strong"),
      row.querySelector(".profile-summary"),
      row.querySelector("code"),
    ];
    const fullText = [profile.displayName, "OpenAI · long-model-name", profile.endpoint];
    for (const line of lines) expect(line.getAttribute("title")).toBeNull();
    lines.forEach((line, index) => {
      h.resize(line, 100, 200);
      expect(line.getAttribute("title")).toBe(fullText[index]);
      h.resize(line, 200, 100);
      expect(line.getAttribute("title")).toBeNull();
    });
  });

  it("rechecks changed content and width, then clears removed and closed rows", () => {
    const h = sidebarHarness();
    h.receive("state:update", { profiles: [profile] });
    const row = h.evaluate('profileRows.get("overflow")');
    const name = row.querySelector("strong");
    h.resize(name, 100, 200);
    expect(name.getAttribute("title")).toBe(profile.displayName);
    h.receive("state:update", {
      profiles: [{ ...profile, revision: 2, displayName: "Renamed profile" }],
    });
    expect(name.getAttribute("title")).toBe("Renamed profile");
    h.resize(name, 250, 200);
    expect(name.getAttribute("title")).toBeNull();
    h.receive("state:update", { profiles: [] });
    expect(name.getAttribute("title")).toBeNull();

    h.receive("state:update", { profiles: [profile] });
    const reopened = h.evaluate('profileRows.get("overflow")');
    const endpoint = reopened.querySelector("code");
    h.resize(endpoint, 100, 200);
    h.event("pagehide");
    expect(endpoint.getAttribute("title")).toBeNull();
  });
});
