import { describe, expect, it } from "vitest";
import { sidebarHarness } from "../helpers/sidebar-harness.js";
import { createLocalizer } from "../../ui/localization.js";
import { parseUiLanguageGet, parseUiLanguageState } from "../../src/domain/messages.js";

describe("localization privacy and text insertion", () => {
  it("renders mixed-direction names only as text", () => {
    const h = sidebarHarness({ locale: "he" });
    const profile = {
      profileId: "profile",
      revision: 1,
      displayName: "<img src=x onerror=alert(1)> שלום",
      kind: "openai",
      endpoint: "https://example.invalid",
      endpointFingerprint: "safe",
      proxyMode: "direct",
      credentialConfigured: false,
    };
    h.receive("state:update", {
      profiles: [profile],
      profileListPhase: "settled",
      status: "disabled",
    });
    const row = h.evaluate('profileRows.get("profile")');
    expect(row.querySelector("strong").textContent).toBe(profile.displayName);
    expect(row.querySelector("strong").children).toHaveLength(0);
    h.evaluate("loadEditor(" + JSON.stringify(profile) + ")");
    h.activate("#delete-profile");
    expect(h.element("#profile-delete-title").textContent).toBe(
      createLocalizer("he").format("profile.deleteTitle", { name: profile.displayName }),
    );
    expect(h.element("#profile-delete-title").children).toHaveLength(0);
  });
  it("never reflects unknown raw failures or arbitrary objects", () => {
    const h = sidebarHarness({ locale: "de" });
    h.receive("state:update", {
      status: "serviceUnavailable",
      providerError: {
        category: "unknown",
        message: "PRIVATE_SYNTHETIC_RESPONSE",
        apiKey: "PRIVATE_SYNTHETIC_KEY",
      },
      profiles: [],
      profileListPhase: "settled",
    });
    expect(h.element("#status").textContent).not.toMatch(/PRIVATE|unknown|undefined/);
    expect(
      createLocalizer("de").format("profile.deleteTitle", {
        name: {
          toString() {
            throw new Error("must not invoke");
          },
        },
      } as any),
    ).not.toMatch(/object|undefined/);
  });
  it("rejects credentials and subtitles in language messages", () => {
    expect(() =>
      parseUiLanguageGet({
        requestId: "request",
        sample: {
          hostVersion: "1.5.0",
          preferredLocalization: "de",
          failure: null,
          apiKey: "private",
        },
      }),
    ).toThrow();
    expect(() =>
      parseUiLanguageState({
        requestId: "request",
        context: {
          authorityId: "authority",
          locale: "en",
          direction: "ltr",
          hostVersion: null,
          hostLocalization: null,
          fallbackReason: "unknownVersion",
          subtitle: "private",
        },
      }),
    ).toThrow();
  });
});

it("keeps the credential reveal channel encrypted and clears the editing field on close", async () => {
  const h = sidebarHarness({ locale: "he" });
  h.connectCredentials({ readValue: "synthetic-localization-private-key" });
  const profile = {
    profileId: "private-profile",
    revision: 1,
    displayName: "שם אישי",
    kind: "openai",
    endpoint: "https://example.invalid",
    endpointFingerprint: "synthetic-fingerprint",
    model: "fixture-model",
    proxyMode: "direct",
    credentialConfigured: true,
  };
  h.receive("state:update", {
    profiles: [profile],
    profileListPhase: "settled",
    status: "disabled",
  });
  h.evaluate('loadEditor(profiles.get("private-profile"))');
  await h.settleCredentials();
  expect(h.element("#provider-key").value).toBe("synthetic-localization-private-key");
  expect(h.element("#provider-key").type).toBe("password");
  expect(JSON.stringify(h.messages)).not.toContain("synthetic-localization-private-key");
  h.activate("#toggle-provider-key");
  expect(h.element("#provider-key").type).toBe("text");
  expect(h.element("#toggle-provider-key").getAttribute("aria-label")).toBe(
    createLocalizer("he").format("sidebar.hideAPIKey"),
  );
  h.activate("#cancel-profile");
  expect(h.element("#provider-key").value).toBe("");
  expect(h.element("#provider-key").type).toBe("password");
  expect(h.messages.some((message) => message.name === "credential-channel:close")).toBe(true);
  h.event("pagehide");
});
