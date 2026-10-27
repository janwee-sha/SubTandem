import { describe, expect, it } from "vitest";
import { sidebarHarness } from "../helpers/sidebar-harness.js";
import { UI_LOCALES } from "../../src/shared/localization/locales.js";
import { LOCALE_CATALOGS, createLocalizer } from "../../src/ui/localization.js";
import { TARGET_LANGUAGES } from "../../src/runtime/domain/target-languages.js";
import { ProviderProfiles } from "../../src/runtime/providers/profiles.js";

describe("Sidebar language rendering", () => {
  it.each(UI_LOCALES)("initializes and operates in %s", (locale) => {
    expect(LOCALE_CATALOGS[locale]?.locale).toBe(locale);
    const h = sidebarHarness({ locale });
    h.receive("state:update", {
      status: "disabled",
      profiles: [],
      profileListPhase: "settled",
      targetLanguage: "zh-Hans",
      targetLanguageRevision: 0,
      targetLanguages: TARGET_LANGUAGES,
    });
    const l = createLocalizer(locale);
    expect(h.element("html").lang).toBe(locale);
    expect(h.element("html").dir).toBe(locale === "he" ? "rtl" : "ltr");
    for (const entry of h.evaluate(
      'Array.from(document.querySelectorAll("[data-i18n]")).filter(node=>!["status","endpoint-hint","request-url"].includes(node.id)).map(node=>({key:node.getAttribute("data-i18n"),text:node.textContent}))',
    )) {
      expect(entry.text, entry.key).toBe(l.format(entry.key));
    }
    for (const attribute of ["aria-label", "title", "placeholder"]) {
      const entries = h.evaluate(
        `Array.from(document.querySelectorAll("[data-i18n-${attribute}]")).filter(node=>!["subtitle-font-color","subtitle-border-color","subtitle-background-color"].includes(node.id)).map(node=>({key:node.getAttribute("data-i18n-${attribute}"),text:node.getAttribute("${attribute}")}))`,
      );
      for (const entry of entries) expect(entry.text, entry.key).toBe(l.format(entry.key));
    }
    expect(h.element("#languages-heading").textContent).toBe(l.format("sidebar.subtitle"));
    expect(h.element("#status").textContent).toBe(l.format("sidebar.translationIsOff"));
    expect(h.element("#target-language").value).toBe("zh-Hans");
    expect(h.element("#target-language").disabled).toBe(false);
    h.activate("#new-profile");
    expect(h.element("#provider-key").placeholder).toBe(l.format("sidebar.optional"));
    expect(h.element("#toggle-provider-key").getAttribute("aria-label")).toBe(
      l.format("sidebar.showAPIKey"),
    );
    for (const count of [1, 2, 3, 5, 11, 21, 1000, 1000000]) {
      h.evaluate(
        `setModelRefreshFeedback("success", window.subtandemModelCatalogStatusFeedback({ok:true,count:${count}}))`,
      );
      expect(h.element("#model-catalog-status").textContent).toBe(
        l.format("models.available", { count }),
      );
    }
    h.evaluate(
      'setModelRefreshFeedback("success", window.subtandemModelCatalogStatusFeedback({ok:true,count:0}))',
    );
    expect(h.element("#model-catalog-status").textContent).toBe(
      l.format("sidebar.noModelsWereReturnedCustomModelID"),
    );
    h.activate("#cancel-profile");
    expect(h.evaluate("profileDrawer.hidden")).toBe(true);
  });
});

it.each(UI_LOCALES)(
  "keeps CRUD, discovery, tests and session feedback actionable in %s",
  async (locale) => {
    expect(LOCALE_CATALOGS[locale]?.locale).toBe(locale);
    const h = sidebarHarness({ locale });
    const localizer = createLocalizer(locale);
    h.connectCredentials();
    const profile = {
      profileId: "fixture-profile",
      revision: 1,
      displayName: "User profile Ω",
      kind: "openai",
      endpoint: "https://example.invalid",
      endpointFingerprint: "synthetic-fingerprint",
      model: "fixture-model",
      proxyMode: "direct",
      credentialConfigured: false,
    };
    const snapshot = {
      profiles: [profile],
      profileListPhase: "settled",
      status: "running",
      targetLanguage: "zh-Hans",
      targetLanguageRevision: 0,
      targetLanguages: TARGET_LANGUAGES,
    };
    h.receive("state:update", snapshot);
    h.evaluate('loadEditor(profiles.get("fixture-profile"))');
    await h.settleCredentials();
    expect(h.element("#endpoint-hint").textContent).toBe(
      localizer.format("endpoint.help", { service: "OpenAI", path: "/v1/chat/completions" }),
    );
    expect(h.element("#request-url").textContent).toBe(
      localizer.format("endpoint.request", { url: "https://example.invalid/v1/chat/completions" }),
    );
    h.activate("#refresh-models");
    await h.settleCredentials();
    const pending = h.evaluate("pendingModelRefresh");
    h.receive("provider:models-result", {
      requestId: pending.requestId,
      ok: true,
      contextKey: "synthetic-catalog",
      models: ["Model B", "Model A"],
    });
    expect(h.element("#model-catalog-status").textContent).toBe(
      localizer.format("models.available", { count: 2 }),
    );
    h.activate("#test-profile");
    expect(h.element("#profile-test-status").textContent).toBe(localizer.format("sidebar.testing"));
    await h.settleCredentials();
    const test = h.evaluate("sidebarState.snapshot.drawer.test");
    h.receive("provider:test-result", {
      requestId: test.requestId,
      drawerId: test.drawerId,
      draftRevision: test.draftRevision,
      ok: true,
    });
    expect(h.element("#profile-test-status").textContent).toBe(
      localizer.format("sidebar.testPassed"),
    );
    h.activate("#delete-profile");
    expect(h.element("#profile-delete-title").textContent).toBe(
      localizer.format("profile.deleteTitle", { name: profile.displayName }),
    );
    expect(h.evaluate("document.activeElement")).toBe(h.element("#cancel-profile-delete"));
    h.activate("#cancel-profile-delete");
    expect(h.element("#profile-delete-backdrop").hidden).toBe(true);
    h.activate("#delete-profile");
    h.activate("#confirm-profile-delete");
    expect(h.element("#profile-delete-status").textContent).toBe(
      localizer.format("sidebar.deleting"),
    );
    const deletion = h.messages.findLast((message) => message.name === "profile:delete-request")!;
    h.receive("operation:error", { requestId: deletion.data.requestId });
    expect(
      h.evaluate(
        'profileRows.get("fixture-profile").querySelector(".profile-operation-status").textContent',
      ),
    ).toBe(localizer.format("sidebar.theProfileCouldNotBeDeletedReview"));
    expect(h.evaluate('profiles.has("fixture-profile")')).toBe(true);
    h.activate("#delete-profile");
    h.activate("#confirm-profile-delete");
    const nextDeletion = h.messages.findLast(
      (message) => message.name === "profile:delete-request",
    )!;
    h.receive("profile:deleted", {
      requestId: nextDeletion.data.requestId,
      profileId: profile.profileId,
    });
    expect(h.evaluate('profiles.has("fixture-profile")')).toBe(false);
    expect(h.element("#operation-announcer").textContent).toBe(
      localizer.format("sidebar.profileAndSavedCredentialDeleted"),
    );
    h.activate("#new-profile");
    h.element("#provider-model").value = "fixture-new-model";
    h.element("#provider-model").dispatch("input");
    h.activate("#save-profile");
    expect(h.element("#save-profile").textContent).toBe(localizer.format("sidebar.savingProfile"));
    await h.settleCredentials();
    const preparing = h.messages.findLast((message) => message.name === "profile:save-prepare")!;
    h.receive("profile:save-result", {
      requestId: preparing.data.requestId,
      ok: false,
      sidebarInstanceId: preparing.data.payload.sidebarInstanceId,
      drawerId: preparing.data.payload.drawerId,
    });
    await h.settleCredentials();
    expect(h.element("#profile-editor-status").textContent).toBe(
      localizer.format("sidebar.profileCouldNotBeSaved"),
    );
    expect(h.element("#save-profile").disabled).toBe(false);
    const savedProfiles = new ProviderProfiles(() => "10000000-0000-4000-8000-000000000001");
    const completeSave = async () => {
      h.activate("#save-profile");
      await h.settleCredentials();
      const prepare = h.messages.findLast((message) => message.name === "profile:save-prepare")!;
      const candidate = savedProfiles.createSaveCandidate(prepare.data.payload.input);
      const owner = {
        sidebarInstanceId: prepare.data.payload.sidebarInstanceId,
        drawerId: prepare.data.payload.drawerId,
      };
      const reservation = {
        reservationId: "fixture-reservation",
        requestId: prepare.data.requestId,
        expiresAtMs: Date.now() + 30_000,
        commitId: "10000000-0000-4000-8000-000000000002",
        expectedStoreRevision: 1,
        expectedProfileRevision: prepare.data.payload.input.expectedRevision ?? null,
        profile: candidate,
        profileState: { profiles: [candidate], activation: null },
        sourceProfile: h.evaluate("sidebarState.snapshot.drawer.sourceProfile"),
      };
      h.receive("profile:save-result", {
        requestId: prepare.data.requestId,
        ok: true,
        ...owner,
        payload: reservation,
      });
      await h.settleCredentials();
      const commit = h.messages.findLast((message) => message.name === "profile:save-commit")!;
      expect(commit.data.payload.reservationId).toBe(reservation.reservationId);
      savedProfiles.commitCandidate(candidate);
      const saved = { ...candidate, credentialConfigured: false };
      h.receive("profile:save-result", {
        requestId: commit.data.requestId,
        ok: true,
        ...owner,
        payload: { profile: saved, selectionInvalidated: false },
      });
      await h.settleCredentials();
      expect(h.element("#provider-key").value).toBe("");
      expect(h.evaluate("profileDrawer.hidden")).toBe(true);
      return saved;
    };
    const created = await completeSave();
    expect(created.model).toBe("fixture-new-model");
    expect(created.revision).toBe(1);
    h.receive("state:update", { ...snapshot, profiles: [created] });
    expect(h.evaluate('profiles.get("10000000-0000-4000-8000-000000000001").model')).toBe(
      "fixture-new-model",
    );
    h.evaluate('loadEditor(profiles.get("10000000-0000-4000-8000-000000000001"))');
    await h.settleCredentials();
    h.element("#profile-name").value = "Edited profile Ω";
    h.element("#profile-name").dispatch("input");
    h.element("#provider-model").value = "fixture-edited-model";
    h.element("#provider-model").dispatch("input");
    const updated = await completeSave();
    expect(updated.profileId).toBe(created.profileId);
    expect(updated.revision).toBe(2);
    expect(updated.model).toBe("fixture-edited-model");
    expect(updated.displayName).toBe("Edited profile Ω");
    h.receive("state:update", {
      ...snapshot,
      profiles: [],
      sourcePreparation: { state: "timedOut", canRetry: true, canReselect: true },
    });
    expect(h.element("#status").textContent).toBe(
      localizer.format("sidebar.subtitlePreparationTimedOutPlaybackContinues"),
    );
    h.activate("#retry-subtitle");
    const retry = h.messages.findLast((message) => message.name === "subtitle:retry-preparation")!;
    h.receive("operation:result", {
      requestId: retry.data.requestId,
      action: "retry-preparation",
      cancelled: true,
    });
    expect(h.element("#operation-announcer").textContent).toBe(
      localizer.format("sidebar.operationCancelledNothingWasChanged"),
    );
    const before = h.element("#status").textContent;
    h.receive("state:update", {
      ...snapshot,
      status: "serviceUnavailable",
      providerError: { category: "cancelled" },
    });
    expect(h.element("#status").textContent).toBe(before);
    h.receive("state:update", { ...snapshot, status: "unknown-code" });
    expect(h.element("#status").textContent).toBe(localizer.format("feedback.generic"));
    h.event("pagehide");
  },
);
