import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";
import { parseRetrySubtitlePreparation } from "../../src/domain/messages.js";

await import("../../ui/sidebar-state.js");

describe("IINA sidebar lifecycle contract", () => {
  const mainSource = readFileSync(new URL("../../src/main.ts", import.meta.url), "utf8");
  const controllerSource = readFileSync(
    new URL("../../src/app/controller.ts", import.meta.url),
    "utf8",
  );
  const sidebarSource = readFileSync(new URL("../../ui/sidebar.ts", import.meta.url), "utf8");
  const sidebarStateSource = readFileSync(
    new URL("../../ui/sidebar-state.ts", import.meta.url),
    "utf8",
  );
  const sidebarHtml = readFileSync(new URL("../../ui/sidebar.html", import.meta.url), "utf8");
  const globalSource = readFileSync(new URL("../../src/global.ts", import.meta.url), "utf8");
  const overlayRegionSource = readFileSync(
    new URL("../../src/adapters/iina/overlay-region-runtime.ts", import.meta.url),
    "utf8",
  );

  it("carries selected DeepSeek and Claude kinds into Main translation ownership", () => {
    expect(mainSource).toContain("kind: selection.kind");
    expect(mainSource).toContain("kind: currentSelection.kind");
    expect(controllerSource).toContain(
      'providerKind?: "openai" | "claude" | "deepseek" | "ollama"',
    );
    expect(controllerSource).toContain('this.options.providerKind !== "claude"');
  });

  it("keeps Claude drafts isolated and completes Save through credential ownership", () => {
    expect(sidebarSource).toContain("providerDrafts");
    expect(sidebarSource).toContain('claude: { endpoint: "https://api.anthropic.com"');
    expect(sidebarSource).toContain("saveActiveDraft");
    expect(sidebarSource).toContain("draftCredentialEpoch += 1");
    expect(sidebarSource).toContain("pendingProfileSave.secret");
    expect(sidebarSource).toContain('postMessage(\n      "secret:set"');
    expect(sidebarSource).toContain("profileCredentialPartialFailureMessage");
    expect(sidebarSource).toContain(
      "pendingProfileSave.contextSignature !== editorContextSignature()",
    );
    expect(sidebarSource).toContain("profileTestStates.delete(result.profile.profileId)");
  });

  it("keeps the saved-key hint specific to the active provider kind", () => {
    const start = sidebarSource.indexOf('window.iina?.onMessage("credential:state"');
    const end = sidebarSource.indexOf('window.iina?.onMessage("operation:result"', start);
    const credentialHandler = sidebarSource.slice(start, end);

    expect(credentialHandler).toContain('editingProfile.kind === "claude"');
    expect(credentialHandler).toContain("saved Claude API key");
    expect(credentialHandler).toContain("optional when unauthenticated");
  });

  it("does not let a late Claude save, Test or deletion replace a newer editor owner", () => {
    expect(sidebarSource).toContain("pendingProfileTests");
    expect(sidebarSource).toContain("testedProfile.revision !== tested.revision");
    expect(sidebarSource).toContain("result.requestId !== pendingProfileSave.requestId");
    expect(sidebarSource).toContain("deleteSucceeded");
    expect(sidebarStateSource).toContain("latestRequestByRegion");
  });

  it("gates Claude automatic refresh, sends one manual preview and preserves Custom state", () => {
    const requestStart = sidebarSource.indexOf("function requestModels");
    const requestEnd = sidebarSource.indexOf("function scheduleEndpointModelRefresh", requestStart);
    const requestSource = sidebarSource.slice(requestStart, requestEnd);
    expect(requestSource).toContain('providerKind.value === "claude"');
    expect(requestSource).toContain("usesDraftCredential");
    expect(requestSource).toContain("editingProfile?.credentialConfigured");
    expect(requestSource).toContain('"provider:models-preview"');
    expect(sidebarSource).toContain('setModelRefreshFeedback("busy")');
    expect(sidebarSource).toContain("pendingModelRefresh.contextSignature !== modelContextKey()");
    expect(sidebarSource).toContain("sidebarState.snapshot.modelControl.value");
    expect(sidebarStateSource).toContain("customModelContexts");
  });

  it("covers startup, open, stable endpoint and manual model refresh triggers", () => {
    expect(globalSource).toContain("prefetchProfileModels");
    expect(globalSource).toContain("models-startup-");
    expect(sidebarSource).toContain('requestModels("open")');
    expect(sidebarSource).toContain('requestModels("endpoint")');
    expect(sidebarSource).toContain('requestModels("manual")');
    expect(sidebarSource).toContain("}, 400)");
    expect(sidebarSource).toContain("pendingModelRefresh");
  });

  it("invalidates draft model work when the entered credential changes", () => {
    expect(sidebarSource).toContain('providerKey.addEventListener("input"');
    expect(sidebarSource).toContain("draftCredentialEpoch += 1");
    expect(sidebarSource).toContain('trigger === "manual"');
    expect(sidebarSource).toContain('"provider:models-preview"');
  });

  it("binds DeepSeek save and credential feedback to the current editor context", () => {
    expect(sidebarSource).toContain("function editorContextSignature");
    expect(sidebarSource).toContain("contextSignature: editorContextSignature()");
    expect(sidebarSource).toContain(
      "pendingProfileSave.contextSignature !== editorContextSignature()",
    );
    expect(sidebarSource).toContain("cancelPendingProfileSaveForContextChange");
    expect(sidebarSource).toContain("result.profileId !== pendingProfileSave.profileId");
  });

  it("does not reinterpret repeated ui:ready as a model refresh", () => {
    const readyStart = mainSource.indexOf('runtime.sidebar.onMessage("ui:ready"');
    const readyEnd = mainSource.indexOf('runtime.sidebar.onMessage("ui:poll"', readyStart);
    const readySource = mainSource.slice(readyStart, readyEnd);
    expect(readySource).not.toContain("provider:models");
    expect(sidebarSource).toContain('onMessage("provider:models-result"');
  });

  it("lets the live webview request state instead of posting from the player timer", () => {
    expect(mainSource).toContain('runtime.sidebar.onMessage("ui:poll"');
    expect(sidebarSource).toContain('postMessage("ui:poll"');

    const timerStart = mainSource.indexOf("setInterval(() =>");
    const timerEnd = mainSource.indexOf('runtime.event.on("iina.window-will-close"', timerStart);
    const timerSource = mainSource.slice(timerStart, timerEnd);

    expect(timerStart).toBeGreaterThan(-1);
    expect(timerEnd).toBeGreaterThan(timerStart);
    expect(timerSource).not.toContain("sidebar.postMessage");
  });

  it("keeps the in-memory tick alive when IINA reuses a closed player context", () => {
    expect(mainSource).toContain("clearTimeout(sourceSelectionTimer)");
    const closeStart = mainSource.indexOf('runtime.event.on("iina.window-will-close"');
    const closeSource = mainSource.slice(closeStart);
    expect(closeSource).toContain("closeOverlayRegion()");
    expect(closeSource).toContain("controller.endFile()");
    expect(closeSource).toContain("controller.clearProviderSelection()");
    expect(closeSource).not.toContain("controller.close()");
  });

  it("tears down an ended file without permanently closing the player controller", () => {
    expect(mainSource).toContain('runtime.event.on("mpv.end-file", () => controller.endFile())');
    expect(mainSource).toContain('runtime.event.on("iina.window-will-close"');
    expect(mainSource).toContain("controller.endFile()");
  });

  it("settles real primary-subtitle changes without generated-track suppression", () => {
    expect(mainSource).toContain('runtime.event.on("mpv.sid.changed"');
    expect(mainSource).toContain('runtime.event.on("mpv.track-list.changed"');
    expect(mainSource).not.toContain("generatedTrack");
    expect(mainSource).toContain("setTimeout(attemptSourceReload, 250)");
    expect(mainSource).toContain("sourceReloadAttempt >= 4");
  });

  it("reloads real subtitle changes without translation-track commands or selection writes", () => {
    const eventStart = mainSource.indexOf('runtime.event.on("mpv.sid.changed"');
    const eventEnd = mainSource.indexOf('runtime.event.on("mpv.seek"', eventStart);
    const eventSource = mainSource.slice(eventStart, eventEnd);
    expect(eventSource).toContain("scheduleSourceReload");
    expect(mainSource).not.toContain('"sub-add"');
    expect(mainSource).not.toContain('"sub-remove"');
    expect(mainSource).not.toContain('"secondary-sid"');
  });

  it("waits for IINA's player window before loading the sidebar webview", () => {
    expect(mainSource).toContain("iina.core.window.loaded");
    expect(mainSource).toContain('iina.event.on("iina.window-loaded", scheduleInitializePlayer)');
    expect(
      mainSource.indexOf('iina.event.on("iina.window-loaded", scheduleInitializePlayer)'),
    ).toBeLessThan(mainSource.lastIndexOf("scheduleInitializePlayer();"));
    expect(mainSource).toContain("setTimeout(initializePlayer, 100)");
  });

  it("initializes a normal player without waiting for a global registration reply", () => {
    expect(mainSource).toContain("wirePlayer(iina, `player-${Date.now()}`)");
    expect(mainSource).not.toContain('onMessage("main:registered"');
  });

  it("loads the sidebar before registering handlers that loadFile would clear", () => {
    expect(mainSource.indexOf('runtime.sidebar.loadFile("dist/ui/sidebar.html")')).toBeLessThan(
      mainSource.indexOf('runtime.sidebar.onMessage("ui:ready"'),
    );
  });

  it("requests profile deletion from Main and uses IINA's native confirmation UI", () => {
    expect(sidebarSource).toContain('"profile:delete-request"');
    expect(sidebarSource).not.toContain("window.confirm");
    expect(mainSource).toContain('runtime.sidebar.onMessage("profile:delete-request"');
    expect(mainSource).toContain("runtime.utils.ask");
  });

  it("converges profile deletion only from the authoritative cross-runtime success", () => {
    const handlerStart = mainSource.indexOf('runtime.global.onMessage("profile:deleted"');
    const handlerSource = mainSource.slice(handlerStart, handlerStart + 1_500);
    expect(mainSource).toContain("removeDeletedProfile");
    expect(mainSource).toContain("beginProfileListRequest");
    expect(handlerSource.indexOf("removeDeletedProfile")).toBeLessThan(
      handlerSource.indexOf("requestProfiles"),
    );
    expect(sidebarSource).toContain("deleteSucceeded");
    expect(sidebarSource).toContain('onMessage("profile:deleted"');
  });

  it("keeps request-correlated operation feedback separate from session polling", () => {
    expect(sidebarSource).toContain("pendingOperations");
    expect(sidebarSource).toContain('onMessage("operation:result"');
    expect(sidebarSource).toContain("requestId");
    expect(sidebarSource).toContain("aria-busy");
  });

  it("settles only the matching target-language save and rolls failures back", () => {
    const resultStart = sidebarSource.indexOf('onMessage("operation:result"');
    const errorStart = sidebarSource.indexOf('onMessage("operation:error"', resultStart);
    const stateStart = sidebarSource.indexOf('onMessage("state:update"', errorStart);
    const resultSource = sidebarSource.slice(resultStart, errorStart);
    const errorSource = sidebarSource.slice(errorStart, stateStart);

    expect(sidebarSource).toContain("function finishLanguageSave");
    expect(sidebarSource).toContain("requestId !== pendingLanguageSaveRequestId");
    expect(sidebarSource).toContain("targetLanguage.value = committedTargetLanguage");
    expect(resultSource).toContain("committedTargetLanguage = result.targetLanguage");
    expect(resultSource).toContain("targetLanguageRevision = result.targetLanguageRevision");
    expect(resultSource).toContain("result.cancelled");
    expect(resultSource).toContain("if (!accepted) return");
    expect(errorSource).toContain("finishLanguageSave(result.requestId)");
    expect(errorSource).toContain("if (languageSaveAccepted)");
  });

  it("keeps a pending candidate across stale snapshots and ignores late or duplicate results", () => {
    const resultStart = sidebarSource.indexOf('onMessage("operation:result"');
    const errorStart = sidebarSource.indexOf('onMessage("operation:error"', resultStart);
    const stateStart = sidebarSource.indexOf('onMessage("state:update"', errorStart);
    const stateSource = sidebarSource.slice(stateStart);

    expect(sidebarSource).toContain("requestId !== pendingLanguageSaveRequestId");
    expect(sidebarSource).toContain("pendingLanguageSaveRequestId = null");
    expect(stateSource).toContain("!pendingLanguageSaveRequestId");
    expect(stateSource).toContain("const displayedTargetLanguage = targetLanguage.value");
    expect(stateSource).toContain("option.value === displayedTargetLanguage");
    expect(stateSource).toContain("committedTargetLanguage = view.targetLanguage");
    expect(stateSource).toContain("targetLanguage.value = committedTargetLanguage");
    expect(stateSource).not.toContain("targetLanguageDirty");
  });

  it("binds every operation to its local region and ignores unowned late feedback", () => {
    for (const region of [
      "translation-toggle",
      "language-settings",
      "profile-editor",
      "profile-row:",
      "subtitle-retry",
    ])
      expect(sidebarSource).toContain(region);
    expect(sidebarSource).toContain("sidebarState.finishOperation");
    expect(sidebarSource).toContain("if (!finished.accepted) return");
  });

  it("coordinates assistive success and visible exceptions without coupling either to busy", () => {
    expect(sidebarStateSource).toContain("latestRequestByRegion");
    expect(sidebarStateSource).toContain("activeFeedback");
    expect(sidebarStateSource).toContain('visibility: "assistive" | "visible"');
    expect(sidebarStateSource).toContain('phase === "error" ? "visible" : "assistive"');
    expect(sidebarSource).toContain("renderActiveFeedback");
    expect(sidebarSource).toContain("operationAnnouncer");
    expect(sidebarStateSource).not.toContain("expiresAt");
    expect(sidebarStateSource).not.toContain("expireFeedback");
    expect(sidebarSource).not.toContain("scheduleFeedbackExpiry");
    expect(sidebarStateSource).not.toContain("SidebarDeletedResult");
    expect(sidebarSource).not.toContain("deletedResults");
  });

  it("redraws Profile rows from request ownership and only restores visible exceptions", () => {
    const renderStart = sidebarSource.indexOf("function renderProfiles");
    const renderEnd = sidebarSource.indexOf('window.iina?.onMessage("state:update"', renderStart);
    const renderSource = sidebarSource.slice(renderStart, renderEnd);

    expect(renderSource).toContain("latestRequestByRegion");
    expect(renderSource).toContain("renderActiveFeedback");
    expect(renderSource).toContain('className = "profile-test-state"');
    expect(renderSource).not.toContain("deletedResults");
  });

  it("keeps Update selection invalidation through optional credential completion", () => {
    expect(sidebarSource).toContain("beginProfileSave");
    expect(sidebarSource).toContain("profileRevisionCreated");
    expect(sidebarSource).toContain("completeProfileSave");
    expect(sidebarSource).toContain("reconcileEditingProfile");
    expect(sidebarSource).toContain("Profile updated. Select it again for translation.");
    expect(sidebarSource).toContain("Profile saved, but the credential was not saved.");
    expect(sidebarSource).not.toContain("to authorize translation");
  });

  it("lets credential completion replace cancelled model work and publishes the created profile", () => {
    expect(sidebarSource).toContain('trigger !== "credential"');
    expect(mainSource).toContain("upsertCreatedProfile");
    const createdStart = mainSource.indexOf('runtime.global.onMessage("profile:revision-created"');
    const createdSource = mainSource.slice(createdStart, createdStart + 1_600);
    expect(createdSource).toContain("updateSidebarState({ profiles:");
    expect(createdSource.indexOf("upsertCreatedProfile")).toBeLessThan(
      createdSource.indexOf('queueSidebarMessage("profile:revision-created"'),
    );
  });

  it("prioritizes every safe embedded preparation state and exposes Retry only when allowed", () => {
    for (const text of [
      "Preparing the selected embedded subtitle…",
      "This subtitle type is not supported. Select a text subtitle in IINA.",
      "Embedded subtitles in remote media are not supported.",
      "The selected subtitle is empty or unreadable.",
      "Subtitle preparation timed out. Playback continues.",
      "Subtitle preparation failed. Playback continues.",
    ])
      expect(sidebarSource).toContain(text);
    expect(sidebarSource).toContain('postMessage("subtitle:retry-preparation"');
    expect(sidebarSource).toContain("canRetry");
    expect(mainSource).toContain('runtime.sidebar.onMessage("subtitle:retry-preparation"');
  });

  it("announces subtitle preparation state once in the Session card", () => {
    expect(sidebarHtml).not.toContain('id="source-preparation"');
    expect(sidebarSource).not.toContain("sourcePreparation.textContent");
  });

  it("accepts only a strict revisioned empty Retry envelope", () => {
    expect(
      parseRetrySubtitlePreparation({ requestId: "retry-1", revision: 1, payload: {} }),
    ).toEqual({ requestId: "retry-1", revision: 1, payload: {} });
    expect(() =>
      parseRetrySubtitlePreparation({ requestId: "retry-1", revision: 0, payload: {} }),
    ).toThrow("INVALID_MESSAGE");
    expect(() =>
      parseRetrySubtitlePreparation({
        requestId: "retry-1",
        revision: 1,
        payload: { path: "/private/media" },
      }),
    ).toThrow("INVALID_MESSAGE");
  });

  it("hydrates overlay position snapshots without overwriting a newer local interaction", () => {
    const state = globalThis.createSubTandemSidebarState();
    expect(
      state.applyOverlayPositionState({
        phase: "snapshot",
        position: 25,
        committedPosition: 25,
        intentSequence: 3,
        committedRevision: 1,
      }),
    ).toBe(true);
    state.previewOverlayPosition(80);
    expect(
      state.applyOverlayPositionState({
        phase: "snapshot",
        position: 25,
        committedPosition: 25,
        intentSequence: 3,
        committedRevision: 1,
      }),
    ).toBe(false);
    expect(state.snapshot.overlayPosition.displayPosition).toBe(80);
  });

  it("requests an authoritative overlay position for startup and each live Sidebar", () => {
    expect(mainSource).toContain('runtime.global.postMessage("overlay-position:get"');
    const readyStart = mainSource.indexOf('runtime.sidebar.onMessage("ui:ready"');
    const pollStart = mainSource.indexOf('runtime.sidebar.onMessage("ui:poll"', readyStart);
    expect(mainSource.slice(readyStart, pollStart)).toContain("requestOverlayPosition()");
    expect(globalSource).toContain('iina.global.onMessage("overlay-position:get"');
    expect(globalSource).toContain("overlayPositionPreferences.read().position");
  });

  it("tracks IINA native subtitle margins for overlay endpoint parity", () => {
    expect(overlayRegionSource).toContain('this.mpv.getNumber("sub-margin-x")');
    expect(overlayRegionSource).toContain('this.mpv.getNumber("sub-margin-y")');
    expect(overlayRegionSource).toContain('this.mpv.getNumber("sub-margin-y-offset")');
    expect(mainSource).toContain('runtime.event.on("mpv.sub-margin-x.changed"');
    expect(mainSource).toContain('runtime.event.on("mpv.sub-margin-y.changed"');
    expect(mainSource).toContain('runtime.event.on("mpv.sub-margin-y-offset.changed"');
    expect(overlayRegionSource).not.toContain('this.mpv.getNumber("osd-margin-');
    expect(mainSource).not.toContain('runtime.event.on("mpv.osd-margin-');
  });

  it("polls host-only region inputs and detaches readers before shutdown or close", () => {
    expect(mainSource).toContain("new OverlayRegionRuntime(");
    expect(mainSource).not.toContain('runtime.event.on("mpv.osd-dimensions.changed"');
    expect(mainSource).not.toContain('runtime.event.on("mpv.sub-use-margins.changed"');
    expect(mainSource).not.toContain('runtime.event.on("mpv.sub-ass-force-margins.changed"');
    expect(mainSource).toContain("overlayRegion.pollDynamicInputs()");
    expect(mainSource).toContain("const overlayRegionTimer = setInterval(");
    expect(mainSource).toContain('runtime.event.on("iina.window-fs.changed", (fullscreen)');
    expect(mainSource).toContain("overlayRegion.setFullscreen(fullscreen)");
    expect(mainSource).not.toContain(
      'runtime.event.on("iina.window-resized", refreshOverlayRegion)',
    );
    expect(mainSource).not.toContain(
      'runtime.event.on("iina.window-size-adjusted", refreshOverlayRegion)',
    );
    expect(mainSource).toContain('runtime.event.on("mpv.shutdown", closeOverlayRegion)');
    const shutdownStart = mainSource.indexOf("const closeOverlayRegion =");
    const shutdownEnd = mainSource.indexOf('runtime.event.on("mpv.shutdown"', shutdownStart);
    const shutdownBlock = mainSource.slice(shutdownStart, shutdownEnd);
    expect(shutdownBlock).toContain("clearInterval(overlayRegionTimer)");
    expect(shutdownBlock).toContain("overlayRegion.close()");
    const closeStart = mainSource.indexOf('runtime.event.on("iina.window-will-close"');
    const closeEnd = mainSource.indexOf("});", closeStart);
    const closeBlock = mainSource.slice(closeStart, closeEnd);
    expect(closeBlock).toContain("closeOverlayRegion()");
    expect(closeBlock.indexOf("closeOverlayRegion()")).toBeLessThan(
      closeBlock.indexOf("translationOverlay.close()"),
    );
  });
});

describe("Subtitle Font lifecycle contract", () => {
  const mainSource = readFileSync(new URL("../../src/main.ts", import.meta.url), "utf8");
  const globalSource = readFileSync(new URL("../../src/global.ts", import.meta.url), "utf8");
  const sidebarSource = readFileSync(new URL("../../ui/sidebar.ts", import.meta.url), "utf8");

  it("previews and commits each Font field through strict single-field edits", () => {
    expect(sidebarSource).toMatch(/postMessage\(\s*"subtitle-style:edit"/);
    expect(sidebarSource).toContain('phase: "preview"');
    expect(sidebarSource).toContain('phase: "commit"');
    for (const field of ["fontColor", "fontSize", "fontFamily", "bold", "italic"])
      expect(sidebarSource).toContain(`"${field}"`);
    expect(mainSource).toContain('runtime.sidebar.onMessage("subtitle-style:edit"');
    expect(globalSource).toContain('iina.global.onMessage("subtitle-style:edit"');
  });

  it("requests the font picker, expresses control activity and handles latest-only safe results", () => {
    expect(sidebarSource).toMatch(/postMessage\(\s*"subtitle-style:picker-open"/);
    expect(sidebarSource).toContain('kind: "font"');
    expect(sidebarSource).toContain('fontButton.setAttribute("aria-busy"');
    expect(sidebarSource).toContain('onMessage("subtitle-style:state"');
    expect(sidebarSource).toContain('onMessage("subtitle-style:save-result"');
    expect(sidebarSource).toContain('onMessage("subtitle-style:picker-result"');
    expect(sidebarSource).not.toMatch(/rawError|stderr|helperToken/);
  });

  it("requests authoritative style at startup and when Sidebar becomes live", () => {
    expect(mainSource).toContain('runtime.global.postMessage("subtitle-style:get"');
    expect(globalSource).toContain('iina.global.onMessage("subtitle-style:get"');
    const readyStart = mainSource.indexOf('runtime.sidebar.onMessage("ui:ready"');
    const pollStart = mainSource.indexOf('runtime.sidebar.onMessage("ui:poll"', readyStart);
    expect(mainSource.slice(readyStart, pollStart)).toContain("requestSubtitleStyle()");
  });
});

describe("Subtitle Border and Background lifecycle contract", () => {
  const sidebarSource = readFileSync(new URL("../../ui/sidebar.ts", import.meta.url), "utf8");
  const sidebarStateSource = readFileSync(
    new URL("../../ui/sidebar-state.ts", import.meta.url),
    "utf8",
  );

  it("routes the shared palette only to its explicit color target", () => {
    expect(sidebarStateSource).toContain("openSubtitleColorPalette");
    expect(sidebarStateSource).toContain("closeSubtitleColorPalette");
    expect(sidebarSource).toContain('openColorPalette("fontColor"');
    expect(sidebarSource).toContain('openColorPalette("borderColor"');
    expect(sidebarSource).toContain('openColorPalette("backgroundColor"');
    expect(sidebarSource).toContain("snapshot.subtitleStyle.colorTarget");
    expect(sidebarSource).toContain("commitSubtitleStyle(colorTarget");
  });

  it("previews and commits Border and Background fields without disabling Font", () => {
    for (const field of ["borderColor", "borderWidth", "backgroundColor"])
      expect(sidebarSource).toContain(`"${field}"`);
    expect(sidebarSource).toContain('commitSubtitleStyle("borderWidth"');
    expect(sidebarSource).not.toContain("subtitleStyleControls.disabled");
  });
});

describe("System color picker lifecycle contract", () => {
  const sidebarSource = readFileSync(new URL("../../ui/sidebar.ts", import.meta.url), "utf8");
  const globalSource = readFileSync(new URL("../../src/global.ts", import.meta.url), "utf8");
  const mainSource = readFileSync(new URL("../../src/main.ts", import.meta.url), "utf8");
  const colorPickerSource = readFileSync(
    new URL(
      "../../native/style-picker/Sources/SubTandemStylePicker/ColorPicker.swift",
      import.meta.url,
    ),
    "utf8",
  );
  const serverSource = readFileSync(
    new URL(
      "../../native/style-picker/Sources/SubTandemStylePicker/Server.swift",
      import.meta.url,
    ),
    "utf8",
  );

  it("opens the native panel for the current target and retains field isolation", () => {
    expect(sidebarSource).toContain('subtitleShowColors.addEventListener("click"');
    expect(sidebarSource).toContain('kind: "color"');
    expect(sidebarSource).toContain("beginSubtitleColorPicker");
    expect(sidebarSource).toContain("colorTarget");
    expect(sidebarSource).toContain("pendingColorPickerRequestId");
  });

  it("returns focus on preset, Escape and unchanged close without leaking raw errors", () => {
    expect(sidebarSource).toContain("closeColorPalette(true)");
    expect(sidebarSource).toContain('event.key !== "Escape"');
    expect(sidebarSource).toContain("finishSubtitleColorPicker");
    expect(sidebarSource).toContain('outcome === "unchanged"');
    expect(sidebarSource).not.toMatch(/rawError|stderr|helperToken|Authorization/);
  });

  it("closes palettes outside their window and silently fronts an active native picker", () => {
    expect(sidebarSource).toContain('document.addEventListener("pointerdown"');
    expect(sidebarSource).toContain('window.addEventListener("blur"');
    expect(colorPickerSource).toContain("func windowDidResignKey");
    expect(sidebarSource).toContain('postMessage("subtitle-style:picker-focus"');
    expect(mainSource).toContain('runtime.sidebar.onMessage("subtitle-style:picker-focus"');
    expect(globalSource).toContain('iina.global.onMessage("subtitle-style:picker-focus"');
    expect(globalSource).toContain("client.activate");
    expect(serverSource).toContain('case "/v1/activate"');
    expect(sidebarSource).not.toContain("Another subtitle style picker is already open.");
  });

  it("keeps routine style saves silent while preserving control busy semantics", () => {
    expect(sidebarSource).not.toMatch(/Saving \$\{fontSaving\}/);
    expect(sidebarSource).not.toMatch(/Saving (fontColor|bold|italic)/);
    expect(sidebarSource).toContain('setAttribute("aria-busy"');
  });

  it("builds the IINA-like shade grid as named RGBA controls using the shared target path", () => {
    expect(sidebarSource).toContain("populateSubtitleColorGrid");
    expect(sidebarSource).toContain("subtitleColorFamilies");
    expect(sidebarSource).toContain("button.dataset.rgba");
    expect(sidebarSource).toContain('closest<HTMLButtonElement>("button[data-rgba]")');
  });
});
