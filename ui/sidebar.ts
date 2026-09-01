type SessionStatus =
  | "disabled"
  | "waitingForSubtitle"
  | "detectingLanguage"
  | "languageUnrecognized"
  | "languageUnsupported"
  | "noTranslationNeeded"
  | "waitingForConfiguration"
  | "preparing"
  | "running"
  | "partialFailure"
  | "serviceUnavailable";

type ProviderKind = "openai" | "claude" | "deepseek" | "ollama";

interface SessionProviderError {
  category?: string;
  statusCode?: number;
  providerCode?: string;
  userAction?: string;
}

interface ProfileView {
  profileId: string;
  revision: number;
  displayName: string;
  kind: ProviderKind;
  endpoint: string;
  endpointFingerprint: string;
  proxyMode: "system" | "direct";
  model?: string;
  credentialConfigured: boolean;
  modelCatalog?: { contextKey: string; models: string[] };
}

type ProfileTestState = "not tested" | "passed" | "failed";

type SourcePreparationState =
  | "preparing"
  | "ready"
  | "unsupportedType"
  | "remoteUnsupported"
  | "emptyOrUnreadable"
  | "timedOut"
  | "failed"
  | "invalidated";

const labels: Record<SessionStatus, string> = {
  disabled: "Translation is off",
  waitingForSubtitle: "Select a readable external SRT or ASS subtitle",
  detectingLanguage: "Detecting subtitle language…",
  languageUnrecognized: "Subtitle language could not be identified; playback continues",
  languageUnsupported: "This subtitle language is not supported; playback continues",
  noTranslationNeeded: "The subtitle already matches the target language",
  waitingForConfiguration: "Select and test a translation service",
  preparing: "Preparing nearby translations…",
  running: "Translations are running",
  partialFailure: "Some cues could not be translated; playback continues",
  serviceUnavailable: "Translation service unavailable; playback continues",
};

const sourceIssueLabels: Record<string, string> = {
  "not-external": "Select an external SRT or ASS subtitle track.",
  unreadable: "IINA has not exposed readable subtitle data yet; reselect the external subtitle.",
  "unsupported-format": "The selected external subtitle is not readable SRT or ASS text.",
  "unsupported-encoding": "The selected subtitle encoding is not supported.",
  empty: "The selected subtitle contains no readable cues.",
};

const sourcePreparationLabels: Record<SourcePreparationState, string> = {
  preparing: "Preparing the selected embedded subtitle…",
  ready: "",
  unsupportedType: "This subtitle type is not supported. Select a text subtitle in IINA.",
  remoteUnsupported: "Embedded subtitles in remote media are not supported.",
  emptyOrUnreadable: "The selected subtitle is empty or unreadable.",
  timedOut: "Subtitle preparation timed out. Playback continues.",
  failed: "Subtitle preparation failed. Playback continues.",
  invalidated: "The subtitle selection changed. Reselect a subtitle in IINA.",
};

function safeProviderErrorDetail(error: SessionProviderError | null | undefined): string {
  if (!error) return "";
  if (typeof error.statusCode === "number") return `HTTP ${error.statusCode}`;
  const category: Record<string, string> = {
    network: "Network request failed",
    timeout: "Provider request timed out",
    authentication: "Authentication failed",
    model: "Model is unavailable",
    quota: "Quota or rate limit reached",
    protocol: "Provider response was incompatible",
    configuration: "Provider configuration was rejected",
  };
  return category[error.category ?? ""] ?? "Provider request failed";
}

const statusMessage = document.querySelector<HTMLParagraphElement>("#status")!;
const statusDot = document.querySelector<HTMLSpanElement>("#status-dot")!;
const sourcePreparationControls = document.querySelector<HTMLElement>(
  "#source-preparation-controls",
)!;
const retrySubtitleButton = document.querySelector<HTMLButtonElement>("#retry-subtitle")!;
const translationStatus = document.querySelector<HTMLParagraphElement>("#translation-status")!;
const languageStatus = document.querySelector<HTMLParagraphElement>("#language-status")!;
const profileEditorStatus = document.querySelector<HTMLParagraphElement>("#profile-editor-status")!;
const subtitleRetryStatus = document.querySelector<HTMLParagraphElement>("#subtitle-retry-status")!;
const enabled = document.querySelector<HTMLInputElement>("#enabled")!;
const targetLanguage = document.querySelector<HTMLSelectElement>("#target-language")!;
const sourceSummary = document.querySelector<HTMLElement>("#source-summary")!;
const providerKind = document.querySelector<HTMLSelectElement>("#provider-kind")!;
const profileName = document.querySelector<HTMLInputElement>("#profile-name")!;
const providerEndpoint = document.querySelector<HTMLInputElement>("#provider-endpoint")!;
const providerModel = document.querySelector<HTMLInputElement>("#provider-model")!;
const providerModelSelect = document.querySelector<HTMLSelectElement>("#provider-model-select")!;
const refreshModelsButton = document.querySelector<HTMLButtonElement>("#refresh-models")!;
const modelCatalogStatus = document.querySelector<HTMLParagraphElement>("#model-catalog-status")!;
const providerProxyMode = document.querySelector<HTMLSelectElement>("#provider-proxy-mode")!;
const providerKey = document.querySelector<HTMLInputElement>("#provider-key")!;
const saveProfileButton = document.querySelector<HTMLButtonElement>("#save-profile")!;
const newProfileButton = document.querySelector<HTMLButtonElement>("#new-profile")!;
const profilesElement = document.querySelector<HTMLElement>("#profiles")!;
const requestUrl = document.querySelector<HTMLElement>("#request-url")!;
const credentialState = document.querySelector<HTMLElement>("#credential-state")!;
const translationPosition = document.querySelector<HTMLInputElement>("#translation-position")!;
const translationPositionValue = document.querySelector<HTMLOutputElement>(
  "#translation-position-value",
)!;
const translationPositionStatus = document.querySelector<HTMLParagraphElement>(
  "#translation-position-status",
)!;
const fontColorButton = document.querySelector<HTMLButtonElement>("#subtitle-font-color")!;
const fontColorSwatch = fontColorButton.querySelector<HTMLElement>(".subtitle-color-swatch")!;
const fontColorValue = fontColorButton.querySelector<HTMLElement>(".subtitle-color-value")!;
const fontSizeSelect = document.querySelector<HTMLSelectElement>("#subtitle-font-size")!;
const fontButton = document.querySelector<HTMLButtonElement>("#subtitle-font-family")!;
const fontBold = document.querySelector<HTMLInputElement>("#subtitle-font-bold")!;
const fontItalic = document.querySelector<HTMLInputElement>("#subtitle-font-italic")!;
const fontStatus = document.querySelector<HTMLParagraphElement>("#subtitle-font-status")!;
const borderColorButton = document.querySelector<HTMLButtonElement>("#subtitle-border-color")!;
const borderColorSwatch = borderColorButton.querySelector<HTMLElement>(".subtitle-color-swatch")!;
const borderColorValue = borderColorButton.querySelector<HTMLElement>(".subtitle-color-value")!;
const borderWidthSelect = document.querySelector<HTMLSelectElement>("#subtitle-border-width")!;
const backgroundColorButton = document.querySelector<HTMLButtonElement>(
  "#subtitle-background-color",
)!;
const backgroundColorSwatch =
  backgroundColorButton.querySelector<HTMLElement>(".subtitle-color-swatch")!;
const backgroundColorValue =
  backgroundColorButton.querySelector<HTMLElement>(".subtitle-color-value")!;
const colorPalette = document.querySelector<HTMLElement>("#subtitle-color-palette")!;
const subtitleShowColors = document.querySelector<HTMLButtonElement>("#subtitle-show-colors")!;
const subtitleStyleError = document.querySelector<HTMLParagraphElement>("#subtitle-style-error")!;
const operationAnnouncer = document.querySelector<HTMLParagraphElement>("#operation-announcer")!;

const providerDrafts: Record<
  ProviderKind,
  { endpoint: string; model: string; proxyMode: "system" | "direct" }
> = {
  openai: { endpoint: "https://api.openai.com/v1", model: "", proxyMode: "system" },
  claude: { endpoint: "https://api.anthropic.com", model: "", proxyMode: "system" },
  deepseek: { endpoint: "https://api.deepseek.com", model: "", proxyMode: "system" },
  ollama: { endpoint: "http://127.0.0.1:11434", model: "", proxyMode: "system" },
};
const providerLabels: Record<ProviderKind, string> = {
  openai: "OpenAI",
  claude: "Claude",
  deepseek: "DeepSeek",
  ollama: "Ollama",
};
const providerUi: Record<
  ProviderKind,
  { endpointHint: string; modelHint: string; modelPlaceholder: string }
> = {
  openai: {
    endpointHint: "Enter a complete HTTP(S) API root. Every value receives /chat/completions.",
    modelHint: "Enter the exact model identifier exposed by this service.",
    modelPlaceholder: "e.g. gpt-translate-fast",
  },
  claude: {
    endpointHint:
      "Enter a complete HTTP(S) Claude API root, optionally ending in /v1. Do not enter a full Messages URL.",
    modelHint: "Refresh the catalog or enter the exact Claude model ID.",
    modelPlaceholder: "Exact Claude model ID",
  },
  deepseek: {
    endpointHint:
      "Enter a complete HTTP(S) DeepSeek API root. Chat requests append /chat/completions.",
    modelHint: "Refresh the catalog or enter the exact DeepSeek model identifier.",
    modelPlaceholder: "Exact DeepSeek model ID",
  },
  ollama: {
    endpointHint: "Enter a complete HTTP(S) Ollama server root.",
    modelHint: "Enter the exact Ollama tag, for example translategemma:12b or qwen3:14b.",
    modelPlaceholder: "e.g. qwen3:14b",
  },
};
const profiles = new Map<string, ProfileView>();
const sidebarState = window.createSubTandemSidebarState();
const profileUpdatedSelectionMessage = "Profile updated. Select it again for translation.";
const profileCredentialPartialFailureMessage =
  "Profile saved, but the credential was not saved. Review the credential status and retry the profile update.";
const profileTestStateLabels: Record<ProfileTestState, string> = {
  "not tested": "Not tested",
  passed: "Test passed",
  failed: "Test failed",
};
const profileTestStates = new Map<string, { revision: number; state: ProfileTestState }>();
const pendingProfileTests = new Map<string, { profileId: string; revision: number }>();
const pendingOperations = new Set<string>();
let activeProviderKind: ProviderKind = "openai";
let editingProfile: ProfileView | null = null;
let selectedProfileId: string | null = null;
let pendingProfileSave: {
  requestId: string;
  secret: string | null;
  contextSignature: string;
  profileId: string | null;
  revision: number | null;
} | null = null;
let renderedAssistiveFeedbackSignature = "";
let requestSequence = 0;
let renderedProfilesSignature = "";
let targetLanguageRevision = 1;
let committedTargetLanguage = "zh-Hans";
let targetLanguageHydrated = false;
let pendingLanguageSaveRequestId: string | null = null;
let renderedLanguageCatalogSignature = "";
let subtitleRetryAvailable = false;
let endpointRefreshTimer: ReturnType<typeof setTimeout> | null = null;
let draftCredentialEpoch = 1;
let pendingModelRefresh: {
  requestId: string;
  contextSignature: string;
  stateContextKey: string;
  trigger: string;
  credentialSource: "saved" | "entered" | "none";
  kind: ProviderKind;
  endpoint: string;
  proxyMode: "system" | "direct";
} | null = null;
let subtitleStyleInteractionSequence = 0;
let pendingFontPickerRequestId: string | null = null;
let pendingColorPickerRequestId: string | null = null;

function nextRequestId(): string {
  requestSequence += 1;
  return `ui-${Date.now()}-${requestSequence}`;
}

function envelope(
  payload: Record<string, unknown>,
  requestId = nextRequestId(),
  revision = 1,
): Record<string, unknown> {
  return { requestId, revision, payload };
}

function renderOverlayPosition(): void {
  const state = sidebarState.snapshot.overlayPosition;
  translationPosition.value = String(state.displayPosition);
  translationPositionValue.value = String(state.displayPosition);
  translationPosition.setAttribute("aria-busy", String(state.feedback === "saving"));
  translationPositionStatus.classList.toggle(
    "assistive-only",
    state.feedback === "saving" || state.feedback === "saved",
  );
  translationPositionStatus.dataset.state =
    state.feedback === "saved" ? "success" : state.feedback === "error" ? "error" : "busy";
  translationPositionStatus.textContent =
    state.feedback === "saving"
      ? "Saving translation position…"
      : state.feedback === "saved"
        ? "Translation position saved."
        : state.feedback === "error"
          ? "Translation position could not be saved. The previous position remains active."
          : "";
}

function subtitleStyleInteractionId(field: SidebarSubtitleStyleField): string {
  subtitleStyleInteractionSequence += 1;
  return `style-edit:${field}:${Date.now()}:${subtitleStyleInteractionSequence}`;
}

function rgbaLabel(color: SidebarRgbaColor): string {
  const alpha = Math.round((color.a / 255) * 100);
  if (color.a === 0) return `Transparent · 0%`;
  if (color.r === 255 && color.g === 255 && color.b === 255) return `White · ${alpha}%`;
  if (color.r === 0 && color.g === 0 && color.b === 0) return `Black · ${alpha}%`;
  return `RGBA ${color.r}, ${color.g}, ${color.b}, ${alpha}%`;
}

function rgbaCss(color: SidebarRgbaColor): string {
  return `rgba(${color.r}, ${color.g}, ${color.b}, ${color.a / 255})`;
}

const colorControls: Record<
  SidebarSubtitleColorField,
  { button: HTMLButtonElement; swatch: HTMLElement; value: HTMLElement; label: string }
> = {
  fontColor: {
    button: fontColorButton,
    swatch: fontColorSwatch,
    value: fontColorValue,
    label: "Font Color",
  },
  borderColor: {
    button: borderColorButton,
    swatch: borderColorSwatch,
    value: borderColorValue,
    label: "Border Color",
  },
  backgroundColor: {
    button: backgroundColorButton,
    swatch: backgroundColorSwatch,
    value: backgroundColorValue,
    label: "Background Color",
  },
};

function renderColorControl(field: SidebarSubtitleColorField, color: SidebarRgbaColor): void {
  const control = colorControls[field];
  control.swatch.style.setProperty("--subtitle-swatch", rgbaCss(color));
  control.value.textContent = rgbaLabel(color);
  control.button.setAttribute("aria-label", `${control.label}: ${rgbaLabel(color)}`);
}

function renderSubtitleStyle(): void {
  const state = sidebarState.snapshot.subtitleStyle;
  const style = state.displayStyle;
  renderColorControl("fontColor", style.fontColor);
  renderColorControl("borderColor", style.borderColor);
  renderColorControl("backgroundColor", style.backgroundColor);
  fontSizeSelect.value = String(style.fontSize);
  borderWidthSelect.value = String(style.borderWidth);
  fontButton.textContent = style.fontFamily ?? "System Default";
  fontBold.checked = style.bold;
  fontItalic.checked = style.italic;
  const fontSaving = ["fontColor", "fontSize", "fontFamily", "bold", "italic"].find(
    (field) => state.feedbackByField[field as SidebarSubtitleStyleField] === "saving",
  );
  fontStatus.textContent = state.fontResolution.fallbackActive
    ? `${state.fontResolution.preferredFamily} is unavailable; using System Font.`
    : fontSaving
      ? `Saving ${fontSaving}…`
      : "";
  fontStatus.dataset.state = state.fontResolution.fallbackActive ? "error" : "busy";
  for (const field of ["fontColor", "borderColor", "backgroundColor"] as const) {
    const control = colorControls[field];
    control.button.setAttribute("aria-busy", String(state.feedbackByField[field] === "saving"));
    control.button.setAttribute("aria-expanded", String(state.colorTarget === field));
  }
  borderWidthSelect.setAttribute(
    "aria-busy",
    String(state.feedbackByField.borderWidth === "saving"),
  );
  const selectedColor = state.colorTarget ? style[state.colorTarget] : null;
  for (const preset of Array.from(
    colorPalette.querySelectorAll<HTMLButtonElement>("button[data-rgba]"),
  )) {
    const channels = preset.dataset.rgba?.split(",").map(Number) ?? [];
    preset.setAttribute(
      "aria-checked",
      String(
        Boolean(selectedColor) &&
          channels.length === 4 &&
          channels.every(
            (channel, index) =>
              channel ===
              [selectedColor!.r, selectedColor!.g, selectedColor!.b, selectedColor!.a][index],
          ),
      ),
    );
  }
  subtitleStyleError.textContent = state.groupError ?? "";
  subtitleStyleError.dataset.state = state.groupError ? "error" : "";
}

function commitSubtitleStyle(field: SidebarSubtitleStyleField, value: unknown): void {
  const interactionId = subtitleStyleInteractionId(field);
  if (!sidebarState.previewSubtitleStyle(interactionId, field, value)) return;
  renderSubtitleStyle();
  window.iina?.postMessage(
    "subtitle-style:edit",
    envelope({ interactionId, phase: "preview", field, value }),
  );
  const requestId = nextRequestId();
  if (!sidebarState.beginSubtitleStyleSave(requestId, interactionId, field)) return;
  renderSubtitleStyle();
  window.iina?.postMessage(
    "subtitle-style:edit",
    envelope({ interactionId, phase: "commit", field, value }, requestId),
  );
}

function statusForRegion(regionId: string): HTMLParagraphElement | null {
  if (regionId === "translation-toggle") return translationStatus;
  if (regionId === "language-settings") return languageStatus;
  if (regionId === "profile-editor") return profileEditorStatus;
  if (regionId === "subtitle-retry") return subtitleRetryStatus;
  if (regionId === "model-catalog") return modelCatalogStatus;
  if (!regionId.startsWith("profile-row:")) return null;
  const profileId = regionId.slice("profile-row:".length);
  return (
    Array.from(
      profilesElement.querySelectorAll<HTMLParagraphElement>(".profile-operation-status"),
    ).find((status) => status.dataset.profileId === profileId) ?? null
  );
}

function controlForAction(
  actionId: string,
  profileId?: string,
): HTMLButtonElement | HTMLInputElement | HTMLSelectElement | null {
  if (actionId === "translation") return enabled;
  if (actionId === "languages") return targetLanguage;
  if (actionId === "save-profile") return saveProfileButton;
  if (actionId === "retry-preparation") return retrySubtitleButton;
  if (!profileId) return null;
  return (
    Array.from(profilesElement.querySelectorAll<HTMLButtonElement>("button[data-action]")).find(
      (button) => button.dataset.action === actionId && button.dataset.profileId === profileId,
    ) ?? null
  );
}

function idleLabelForAction(actionId: string, profileId?: string): string {
  if (actionId === "save-profile") return editingProfile ? "Update profile" : "Save profile";
  if (actionId === "retry-preparation") return "Retry";
  if (actionId === "select") return selectedProfileId === profileId ? "Selected" : "Select";
  if (actionId === "test") return "Test";
  if (actionId === "delete") return "Delete";
  return "";
}

function setActionBusy(
  actionId: string,
  profileId: string | undefined,
  busy: boolean,
  busyLabel = "",
): void {
  const control = controlForAction(actionId, profileId);
  if (!control) return;
  control.disabled = busy || (actionId === "select" && selectedProfileId === profileId);
  if (busy) control.setAttribute("aria-busy", "true");
  else control.removeAttribute("aria-busy");
  if (control instanceof HTMLButtonElement)
    control.textContent = busy ? busyLabel : idleLabelForAction(actionId, profileId);
}

function updateSubtitleRetryControls(): void {
  const latest = sidebarState.snapshot.latestRequestByRegion["subtitle-retry"];
  const pending = latest ? sidebarState.snapshot.requests[latest.requestId] : undefined;
  const feedback = sidebarState.snapshot.activeFeedback;
  const active = feedback?.regionId === "subtitle-retry" && feedback.visibility === "visible";
  sourcePreparationControls.hidden = !subtitleRetryAvailable && !pending && !active;
  retrySubtitleButton.hidden = !subtitleRetryAvailable;
}

function renderActiveFeedback(): void {
  const feedback = sidebarState.snapshot.activeFeedback;
  const visibleStatus =
    feedback?.visibility === "visible" ? statusForRegion(feedback.regionId) : null;
  for (const status of [
    translationStatus,
    languageStatus,
    profileEditorStatus,
    subtitleRetryStatus,
    ...Array.from(
      profilesElement.querySelectorAll<HTMLParagraphElement>(".profile-operation-status"),
    ),
  ]) {
    if (status !== visibleStatus) {
      delete status.dataset.state;
      status.textContent = "";
    }
  }
  const assistiveFeedbackSignature =
    feedback?.visibility === "assistive"
      ? `${feedback.requestId}:${feedback.phase}:${feedback.message}`
      : "";
  if (assistiveFeedbackSignature !== renderedAssistiveFeedbackSignature) {
    operationAnnouncer.textContent = "";
    renderedAssistiveFeedbackSignature = assistiveFeedbackSignature;
  }
  if (feedback && feedback.visibility === "assistive") {
    if (operationAnnouncer.textContent !== feedback.message)
      operationAnnouncer.textContent = feedback.message;
  } else if (feedback && feedback.visibility === "visible" && visibleStatus) {
    visibleStatus.dataset.state = feedback.phase;
    if (visibleStatus.textContent !== feedback.message)
      visibleStatus.textContent = feedback.message;
  }
  updateSubtitleRetryControls();
}

function renderModelFeedback(): void {
  const state = sidebarState.snapshot.modelControl;
  if (state.refreshState === "idle") delete modelCatalogStatus.dataset.state;
  else modelCatalogStatus.dataset.state = state.refreshState;
  modelCatalogStatus.textContent = state.refreshMessage;
  refreshModelsButton.setAttribute("aria-busy", String(state.refreshState === "busy"));
}

function setModelRefreshFeedback(state: "idle" | "busy" | "success" | "error", message = ""): void {
  sidebarState.setModelRefreshState(state, message);
  renderModelFeedback();
}

function beginOperation(
  regionId: string,
  actionId: string,
  busyLabel: string,
  profileId?: string,
  revision?: number,
): string {
  const requestId = nextRequestId();
  const previousId = sidebarState.snapshot.latestRequestByRegion[regionId]?.requestId;
  const previous = previousId ? sidebarState.snapshot.requests[previousId] : undefined;
  if (previous) setActionBusy(previous.actionId, previous.profileId, false);
  sidebarState.beginOperation(
    {
      requestId,
      regionId,
      actionId,
      ...(profileId ? { profileId } : {}),
      ...(revision === undefined ? {} : { revision }),
    },
    busyLabel,
  );
  pendingOperations.add(requestId);
  setActionBusy(actionId, profileId, true, busyLabel);
  renderActiveFeedback();
  return requestId;
}

function finishOperation(
  requestId: unknown,
  message: string,
  phase: Exclude<SidebarFeedbackPhase, "busy"> = "success",
  visibility?: SidebarFeedbackVisibility,
  renderFeedback = true,
): boolean {
  if (typeof requestId !== "string" || !pendingOperations.has(requestId)) return false;
  const request = sidebarState.snapshot.requests[requestId];
  const finished = sidebarState.finishOperation(requestId, phase, message, visibility);
  pendingOperations.delete(requestId);
  if (!request) return false;
  const latestId = sidebarState.snapshot.latestRequestByRegion[request.regionId]?.requestId;
  const latest = latestId ? sidebarState.snapshot.requests[latestId] : undefined;
  if (!latest || latest.actionId !== request.actionId)
    setActionBusy(request.actionId, request.profileId, false);
  if (!finished.accepted) return false;
  if (renderFeedback) renderActiveFeedback();
  return true;
}

function finishLanguageSave(requestId: unknown): boolean {
  if (typeof requestId !== "string" || requestId !== pendingLanguageSaveRequestId) return false;
  pendingLanguageSaveRequestId = null;
  targetLanguage.value = committedTargetLanguage;
  return true;
}

function saveActiveDraft(): void {
  providerDrafts[activeProviderKind] = {
    endpoint: providerEndpoint.value,
    model: sidebarState.snapshot.modelControl.value,
    proxyMode: providerProxyMode.value === "direct" ? "direct" : "system",
  };
}

function modelContextKey(): string {
  return JSON.stringify({
    kind: providerKind.value,
    endpoint: providerEndpoint.value.trim(),
    proxyMode: providerProxyMode.value,
    profileId: editingProfile?.profileId ?? null,
    profileRevision: editingProfile?.revision ?? null,
    draftCredentialEpoch,
  });
}

function editorContextSignature(): string {
  return JSON.stringify({
    kind: providerKind.value,
    endpoint: providerEndpoint.value.trim(),
    proxyMode: providerProxyMode.value,
    profileId: editingProfile?.profileId ?? null,
    profileRevision: editingProfile?.revision ?? null,
    model: sidebarState.snapshot.modelControl.value,
    draftCredentialEpoch,
  });
}

function cancelPendingProfileSaveForContextChange(): void {
  if (!pendingProfileSave) return;
  const requestId = pendingProfileSave.requestId;
  pendingProfileSave = null;
  sidebarState.cancelProfileSave(requestId);
  finishOperation(
    requestId,
    "The editor changed before this save completed. Refresh the Profile list to review it.",
    "cancelled",
  );
}

function validModelEndpoint(): boolean {
  const value = providerEndpoint.value.trim();
  try {
    const parsed = new URL(value);
    return (
      (parsed.protocol === "http:" || parsed.protocol === "https:") &&
      Boolean(parsed.hostname) &&
      !parsed.username &&
      !parsed.password &&
      !parsed.search &&
      !parsed.hash
    );
  } catch {
    return false;
  }
}

function modelRefreshPayload(trigger: "open" | "endpoint" | "profile" | "credential" | "manual") {
  const endpoint = providerEndpoint.value.trim();
  const matchesSaved =
    editingProfile?.kind === providerKind.value &&
    editingProfile.endpoint === endpoint &&
    editingProfile.proxyMode === providerProxyMode.value;
  return {
    trigger,
    kind: providerKind.value,
    endpoint,
    proxyMode: providerProxyMode.value,
    ...(matchesSaved && editingProfile
      ? {
          profileId: editingProfile.profileId,
          profileRevision: editingProfile.revision,
          endpointFingerprint: editingProfile.endpointFingerprint,
        }
      : {}),
  };
}

function requestModels(trigger: "open" | "endpoint" | "profile" | "credential" | "manual"): void {
  if (!validModelEndpoint()) return;
  const contextSignature = modelContextKey();
  if (
    trigger !== "manual" &&
    trigger !== "credential" &&
    pendingModelRefresh?.contextSignature === contextSignature &&
    pendingModelRefresh.trigger !== "manual"
  )
    return;
  const requestId = nextRequestId();
  const enteredApiKey = providerKey.value;
  const usesDraftCredential = trigger === "manual" && Boolean(enteredApiKey.trim());
  const matchesSaved =
    editingProfile?.kind === providerKind.value &&
    editingProfile.endpoint === providerEndpoint.value.trim() &&
    editingProfile.proxyMode === providerProxyMode.value;
  if (
    providerKind.value === "claude" &&
    !usesDraftCredential &&
    !(matchesSaved && editingProfile?.credentialConfigured)
  ) {
    pendingModelRefresh = null;
    if (trigger === "manual")
      setModelRefreshFeedback("error", "Enter an API key before refreshing Claude models.");
    else setModelRefreshFeedback("idle");
    return;
  }
  pendingModelRefresh = {
    requestId,
    contextSignature,
    stateContextKey: contextSignature,
    trigger,
    credentialSource: usesDraftCredential
      ? "entered"
      : matchesSaved && editingProfile?.credentialConfigured
        ? "saved"
        : "none",
    kind: providerKind.value as ProviderKind,
    endpoint: providerEndpoint.value.trim(),
    proxyMode: providerProxyMode.value === "direct" ? "direct" : "system",
  };
  setModelRefreshFeedback("busy");
  if (usesDraftCredential) {
    window.iina?.postMessage(
      "provider:models-preview",
      envelope(
        {
          trigger: "manual",
          kind: providerKind.value,
          endpoint: providerEndpoint.value.trim(),
          proxyMode: providerProxyMode.value,
          draftCredentialEpoch,
          credential: { apiKey: enteredApiKey },
        },
        requestId,
      ),
    );
    return;
  }
  window.iina?.postMessage("provider:models", envelope(modelRefreshPayload(trigger), requestId));
}

function invalidatePendingModelRefresh(): void {
  const pending = pendingModelRefresh;
  pendingModelRefresh = null;
  if (!pending) return;
  setModelRefreshFeedback("idle");
  if (pending.kind !== "claude") return;
  window.iina?.postMessage(
    "provider:models",
    envelope({
      trigger: "credential",
      kind: "claude",
      endpoint: pending.endpoint,
      proxyMode: pending.proxyMode,
    }),
  );
}

function scheduleEndpointModelRefresh(): void {
  if (endpointRefreshTimer !== null) clearTimeout(endpointRefreshTimer);
  if (pendingModelRefresh?.contextSignature !== modelContextKey()) {
    invalidatePendingModelRefresh();
  }
  setModelContext(sidebarState.snapshot.modelControl.value);
  if (!validModelEndpoint()) return;
  endpointRefreshTimer = setTimeout(() => {
    endpointRefreshTimer = null;
    requestModels("endpoint");
  }, 400);
}

function renderModelControl(): void {
  const state = sidebarState.snapshot.modelControl;
  providerModelSelect.replaceChildren();
  for (const model of state.knownModelIds) {
    const option = document.createElement("option");
    option.value = model;
    option.textContent = model;
    providerModelSelect.append(option);
  }
  const custom = document.createElement("option");
  custom.value = "__custom__";
  custom.textContent = "Custom model ID…";
  providerModelSelect.append(custom);
  providerModelSelect.value = state.mode === "known" ? state.value : "__custom__";
  providerModel.hidden = state.mode === "known";
  providerModel.required = state.mode === "custom";
  providerModel.value = state.value;
}

function setModelContext(value: string, catalog?: { contextKey: string; models: string[] }): void {
  const contextKey = catalog?.contextKey ?? modelContextKey();
  sidebarState.setModelContext(contextKey, value);
  if (catalog) sidebarState.applyModelCatalog(contextKey, catalog.models);
  renderModelControl();
}

function updateRequestUrl(): void {
  const value = providerEndpoint.value.trim().replace(/\/+$/, "");
  const kind = providerKind.value as ProviderKind;
  if (kind === "ollama") {
    requestUrl.textContent = value ? `Ollama API root: ${value}` : "Enter the Ollama server root.";
    return;
  }
  if (kind === "claude") {
    const messagesUrl = /\/v1$/i.test(value) ? `${value}/messages` : `${value}/v1/messages`;
    requestUrl.textContent = value
      ? `Actual request: ${messagesUrl}`
      : "Requests append /v1/messages to this Claude API root.";
    return;
  }
  requestUrl.textContent = value
    ? `Actual request: ${value}/chat/completions`
    : "Requests append /chat/completions to this API root.";
}

function selectedServiceTypeLabel(): string {
  return providerLabels[providerKind.value as ProviderKind];
}

function claudeCredentialRequired(): boolean {
  if (providerKind.value !== "claude") return false;
  return !(
    editingProfile?.kind === "claude" &&
    editingProfile.credentialConfigured &&
    editingProfile.endpoint === providerEndpoint.value.trim() &&
    editingProfile.proxyMode === providerProxyMode.value
  );
}

function applyProviderKind(): void {
  const kind = providerKind.value as ProviderKind;
  activeProviderKind = kind;
  providerEndpoint.value = providerDrafts[kind].endpoint;
  providerProxyMode.value = providerDrafts[kind].proxyMode;
  sidebarState.changeServiceTypeLabel(selectedServiceTypeLabel());
  profileName.value = sidebarState.snapshot.profileName.value;
  document.querySelector<HTMLElement>("#credential-row")!.hidden = false;
  document.querySelector<HTMLElement>("#endpoint-hint")!.textContent =
    providerUi[kind].endpointHint;
  document.querySelector<HTMLElement>("#model-hint")!.textContent = providerUi[kind].modelHint;
  providerModel.placeholder = providerUi[kind].modelPlaceholder;
  providerKey.required = claudeCredentialRequired();
  document.querySelector<HTMLElement>("#credential-hint")!.textContent =
    kind === "claude"
      ? providerKey.required
        ? "Required and write-only. Enter a key to refresh models and save this Claude Profile."
        : "Write-only. Leave blank to keep the saved Claude API key."
      : "Write-only; optional when unauthenticated. Enter a key and refresh models before saving a protected service.";
  setModelContext(providerDrafts[kind].model);
  updateRequestUrl();
}

providerKind.addEventListener("change", () => {
  cancelPendingProfileSaveForContextChange();
  invalidatePendingModelRefresh();
  saveActiveDraft();
  draftCredentialEpoch += 1;
  providerKey.value = "";
  applyProviderKind();
  requestModels("profile");
});
providerEndpoint.addEventListener("input", () => {
  cancelPendingProfileSaveForContextChange();
  providerKey.required = claudeCredentialRequired();
  updateRequestUrl();
  scheduleEndpointModelRefresh();
});
providerProxyMode.addEventListener("change", () => {
  cancelPendingProfileSaveForContextChange();
  invalidatePendingModelRefresh();
  providerKey.required = claudeCredentialRequired();
  setModelContext(sidebarState.snapshot.modelControl.value);
  requestModels("profile");
});
refreshModelsButton.addEventListener("click", () => requestModels("manual"));
providerModelSelect.addEventListener("change", () => {
  cancelPendingProfileSaveForContextChange();
  if (providerModelSelect.value === "__custom__") sidebarState.selectCustomModel();
  else sidebarState.selectKnownModel(providerModelSelect.value);
  renderModelControl();
  if (providerModelSelect.value === "__custom__") providerModel.focus();
});
providerModel.addEventListener("input", () => {
  cancelPendingProfileSaveForContextChange();
  sidebarState.inputCustomModelValue(providerModel.value);
});
providerKey.addEventListener("input", () => {
  cancelPendingProfileSaveForContextChange();
  invalidatePendingModelRefresh();
  draftCredentialEpoch += 1;
  setModelContext(sidebarState.snapshot.modelControl.value);
  setModelRefreshFeedback("idle");
});
profileName.addEventListener("input", () => {
  cancelPendingProfileSaveForContextChange();
  sidebarState.inputProfileName(profileName.value);
});

function loadEditor(profile: ProfileView, preservePendingSave = false): void {
  if (!preservePendingSave) cancelPendingProfileSaveForContextChange();
  invalidatePendingModelRefresh();
  editingProfile = profile;
  draftCredentialEpoch += 1;
  providerKey.value = "";
  sidebarState.setProfileContext({
    editingProfileId: profile.profileId,
    credentialDisplayProfileId: profile.profileId,
  });
  providerKind.value = profile.kind;
  sidebarState.loadProfileName(profile.displayName, selectedServiceTypeLabel());
  profileName.value = sidebarState.snapshot.profileName.value;
  activeProviderKind = profile.kind;
  providerDrafts[profile.kind] = {
    endpoint: profile.endpoint,
    model: profile.model ?? "",
    proxyMode: profile.proxyMode,
  };
  applyProviderKind();
  setModelContext(profile.model ?? "", profile.modelCatalog);
  requestModels("profile");
  providerKey.placeholder = profile.credentialConfigured
    ? "Leave blank to keep saved key"
    : "Not shown after saving";
  saveProfileButton.textContent = "Update profile";
  newProfileButton.hidden = false;
}

function resetEditor(): void {
  cancelPendingProfileSaveForContextChange();
  invalidatePendingModelRefresh();
  editingProfile = null;
  draftCredentialEpoch += 1;
  providerKey.value = "";
  sidebarState.setProfileContext({ editingProfileId: null, credentialDisplayProfileId: null });
  sidebarState.resetProfileName(selectedServiceTypeLabel());
  profileName.value = sidebarState.snapshot.profileName.value;
  providerProxyMode.value = "system";
  providerKey.placeholder = "Not shown after saving";
  saveProfileButton.textContent = "Save profile";
  newProfileButton.hidden = true;
  setModelContext(providerDrafts[activeProviderKind].model);
  requestModels("profile");
}

enabled.addEventListener("change", () => {
  const requestId = beginOperation(
    "translation-toggle",
    "translation",
    enabled.checked ? "Enabling translation…" : "Disabling translation…",
  );
  window.iina?.postMessage(
    "translation:set-enabled",
    envelope({ enabled: enabled.checked }, requestId),
  );
});

targetLanguage.addEventListener("change", () => {
  if (!targetLanguageHydrated || pendingLanguageSaveRequestId) return;
  if (targetLanguage.value === committedTargetLanguage) return;
  const requestId = beginOperation("language-settings", "languages", "Saving languages…");
  pendingLanguageSaveRequestId = requestId;
  window.iina?.postMessage(
    "defaults:save",
    envelope({ targetLanguage: targetLanguage.value }, requestId, targetLanguageRevision),
  );
});

translationPosition.addEventListener("input", () => {
  const position = Number(translationPosition.value);
  if (!sidebarState.previewOverlayPosition(position)) return;
  renderOverlayPosition();
  window.iina?.postMessage("overlay-position:preview", envelope({ position }));
});

function completeOverlayPositionInteraction(): void {
  const position = Number(translationPosition.value);
  if (!Number.isInteger(position) || position < 0 || position > 100) return;
  const requestId = nextRequestId();
  if (!sidebarState.completeOverlayPositionInteraction(requestId)) return;
  renderOverlayPosition();
  window.iina?.postMessage("overlay-position:save", envelope({ position }, requestId));
}

translationPosition.addEventListener("change", completeOverlayPositionInteraction);
window.addEventListener("pointerup", completeOverlayPositionInteraction);
window.addEventListener("pointercancel", completeOverlayPositionInteraction);
window.addEventListener("mouseup", completeOverlayPositionInteraction);
window.addEventListener("touchend", completeOverlayPositionInteraction);

function openColorPalette(colorTarget: SidebarSubtitleColorField): void {
  const wasOpenForTarget =
    !colorPalette.hidden && sidebarState.snapshot.subtitleStyle.colorTarget === colorTarget;
  if (wasOpenForTarget) {
    closeColorPalette(true);
    return;
  }
  if (!sidebarState.openSubtitleColorPalette(colorTarget)) return;
  colorPalette.hidden = false;
  renderSubtitleStyle();
  colorPalette.querySelector<HTMLButtonElement>("button")?.focus();
}

function closeColorPalette(restoreFocus: boolean): void {
  const colorTarget = sidebarState.snapshot.subtitleStyle.colorTarget;
  sidebarState.closeSubtitleColorPalette();
  colorPalette.hidden = true;
  renderSubtitleStyle();
  if (restoreFocus && colorTarget) colorControls[colorTarget].button.focus();
}

fontColorButton.addEventListener("click", () => openColorPalette("fontColor"));
borderColorButton.addEventListener("click", () => openColorPalette("borderColor"));
backgroundColorButton.addEventListener("click", () => openColorPalette("backgroundColor"));

colorPalette.addEventListener("click", (event) => {
  const button = (event.target as Element).closest<HTMLButtonElement>("button[data-rgba]");
  if (!button) return;
  const channels = button.dataset.rgba?.split(",").map(Number) ?? [];
  if (channels.length !== 4 || channels.some((channel) => !Number.isInteger(channel))) return;
  const colorTarget = sidebarState.snapshot.subtitleStyle.colorTarget;
  if (!colorTarget) return;
  commitSubtitleStyle(colorTarget, {
    r: channels[0],
    g: channels[1],
    b: channels[2],
    a: channels[3],
  });
  closeColorPalette(true);
});

colorPalette.addEventListener("keydown", (event) => {
  if (event.key !== "Escape") return;
  closeColorPalette(true);
});

subtitleShowColors.addEventListener("click", () => {
  const colorTarget = sidebarState.snapshot.subtitleStyle.colorTarget;
  if (!colorTarget || pendingColorPickerRequestId) return;
  const requestId = nextRequestId();
  if (!sidebarState.beginSubtitleColorPicker(requestId, colorTarget)) return;
  pendingColorPickerRequestId = requestId;
  closeColorPalette(false);
  renderSubtitleStyle();
  window.iina?.postMessage(
    "subtitle-style:picker-open",
    envelope({ kind: "color", field: colorTarget }, requestId),
  );
});

fontSizeSelect.addEventListener("change", () => {
  commitSubtitleStyle("fontSize", Number(fontSizeSelect.value));
});

borderWidthSelect.addEventListener("change", () => {
  commitSubtitleStyle("borderWidth", Number(borderWidthSelect.value));
});

fontBold.addEventListener("change", () => {
  commitSubtitleStyle("bold", fontBold.checked);
});

fontItalic.addEventListener("change", () => {
  commitSubtitleStyle("italic", fontItalic.checked);
});

fontButton.addEventListener("click", () => {
  if (pendingFontPickerRequestId) return;
  const requestId = nextRequestId();
  pendingFontPickerRequestId = requestId;
  fontButton.setAttribute("aria-busy", "true");
  window.iina?.postMessage(
    "subtitle-style:picker-open",
    envelope({ kind: "font", field: "fontFamily" }, requestId),
  );
});

retrySubtitleButton.addEventListener("click", () => {
  const requestId = beginOperation("subtitle-retry", "retry-preparation", "Retrying…");
  window.iina?.postMessage("subtitle:retry-preparation", envelope({}, requestId));
});

saveProfileButton.addEventListener("click", () => {
  cancelPendingProfileSaveForContextChange();
  const model = sidebarState.snapshot.modelControl.value.trim();
  if (!model) {
    setModelRefreshFeedback("error", "Refresh models and choose one, or enter a custom model ID.");
    providerModel.focus();
    return;
  }
  if (claudeCredentialRequired() && !providerKey.value.trim()) {
    profileEditorStatus.dataset.state = "error";
    profileEditorStatus.textContent = "Enter an API key before saving this Claude Profile.";
    providerKey.focus();
    return;
  }
  const requestId = beginOperation(
    "profile-editor",
    "save-profile",
    editingProfile ? "Updating profile…" : "Saving profile…",
    editingProfile?.profileId,
    editingProfile?.revision,
  );
  pendingProfileSave = {
    requestId,
    secret: providerKey.value.trim() || null,
    contextSignature: editorContextSignature(),
    profileId: editingProfile?.profileId ?? null,
    revision: editingProfile?.revision ?? null,
  };
  sidebarState.beginProfileSave(requestId, Boolean(pendingProfileSave.secret));
  window.iina?.postMessage(
    "profile:save",
    envelope(
      {
        ...(editingProfile
          ? { profileId: editingProfile.profileId, expectedRevision: editingProfile.revision }
          : {}),
        displayName: profileName.value.trim(),
        kind: providerKind.value,
        endpoint: providerEndpoint.value.trim(),
        proxyMode: providerProxyMode.value,
        model,
      },
      requestId,
    ),
  );
});

newProfileButton.addEventListener("click", resetEditor);

profilesElement.addEventListener("click", (event) => {
  const button = (event.target as HTMLElement).closest<HTMLButtonElement>("button[data-action]");
  if (!button || button.disabled) return;
  const profile = profiles.get(button.dataset.profileId ?? "");
  if (!profile) return;
  const selection = {
    profileId: profile.profileId,
    revision: profile.revision,
    endpointFingerprint: profile.endpointFingerprint,
  };
  switch (button.dataset.action) {
    case "edit":
      loadEditor(profile);
      break;
    case "select": {
      loadEditor(profile);
      const requestId = beginOperation(
        `profile-row:${profile.profileId}`,
        "select",
        "Selecting…",
        profile.profileId,
        profile.revision,
      );
      window.iina?.postMessage("profile:select", envelope(selection, requestId));
      break;
    }
    case "test": {
      const requestId = beginOperation(
        `profile-row:${profile.profileId}`,
        "test",
        "Testing…",
        profile.profileId,
        profile.revision,
      );
      pendingProfileTests.set(requestId, {
        profileId: profile.profileId,
        revision: profile.revision,
      });
      window.iina?.postMessage("provider:test", envelope(selection, requestId));
      break;
    }
    case "delete": {
      const requestId = beginOperation(
        `profile-row:${profile.profileId}`,
        "delete",
        "Confirming…",
        profile.profileId,
        profile.revision,
      );
      window.iina?.postMessage(
        "profile:delete-request",
        envelope(
          {
            profileId: profile.profileId,
            expectedRevision: profile.revision,
            displayName: profile.displayName,
          },
          requestId,
        ),
      );
      break;
    }
  }
});

window.iina?.onMessage("profile:revision-created", (raw: unknown) => {
  const result = raw as {
    requestId?: string;
    profile?: ProfileView;
    selectionInvalidated?: boolean;
  };
  if (
    !result.profile ||
    !pendingProfileSave ||
    result.requestId !== pendingProfileSave.requestId ||
    pendingProfileSave.contextSignature !== editorContextSignature()
  )
    return;
  const transition = sidebarState.profileRevisionCreated(result.requestId, {
    profileId: result.profile.profileId,
    revision: result.profile.revision,
    selectionInvalidated: result.selectionInvalidated === true,
  });
  if (!transition.accepted) return;
  profileTestStates.delete(result.profile.profileId);
  pendingProfileSave.profileId = result.profile.profileId;
  pendingProfileSave.revision = result.profile.revision;
  loadEditor(result.profile, true);
  pendingProfileSave.contextSignature = editorContextSignature();
  if (pendingProfileSave.secret) {
    window.iina?.postMessage(
      "secret:set",
      envelope(
        {
          profileId: result.profile.profileId,
          expectedRevision: result.profile.revision,
          fields: { apiKey: pendingProfileSave.secret },
        },
        pendingProfileSave.requestId,
      ),
    );
  } else {
    const message =
      sidebarState.completeProfileSave(result.requestId, "Profile saved.") ??
      profileUpdatedSelectionMessage;
    finishOperation(result.requestId, message);
    pendingProfileSave = null;
  }
  window.iina?.postMessage("ui:ready", envelope({}));
});

window.iina?.onMessage("profile:selected", (raw: unknown) => {
  const result = raw as { requestId?: string; selection?: { profileId?: string } };
  selectedProfileId = result.selection?.profileId ?? selectedProfileId;
  sidebarState.setProfileContext({ selectedProfileId });
  finishOperation(result.requestId, "Profile selected for translation.");
});

window.iina?.onMessage("profile:deleted", (raw: unknown) => {
  const result = raw as { requestId?: string; profileId?: string };
  if (typeof result.requestId !== "string" || typeof result.profileId !== "string") return;
  sidebarState.deleteSucceeded({
    requestId: result.requestId,
    profileId: result.profileId,
    message: "Profile and saved credential deleted.",
  });
  if (editingProfile?.profileId === result.profileId) resetEditor();
  if (selectedProfileId === result.profileId) {
    selectedProfileId = null;
    sidebarState.setProfileContext({ selectedProfileId: null });
  }
  profileTestStates.delete(result.profileId);
  for (const [requestId, tested] of pendingProfileTests) {
    if (tested.profileId === result.profileId) pendingProfileTests.delete(requestId);
  }
  pendingOperations.delete(result.requestId);
  renderedProfilesSignature = "";
  renderProfiles(sidebarState.snapshot.profiles as unknown as ProfileView[]);
  window.iina?.postMessage("ui:ready", envelope({}));
});

window.iina?.onMessage("provider:test-result", (raw: unknown) => {
  const result = raw as {
    requestId?: string;
    ok?: boolean;
    category?: string;
    userAction?: string;
  };
  const tested =
    typeof result.requestId === "string" ? pendingProfileTests.get(result.requestId) : undefined;
  const testedProfile = tested ? profiles.get(tested.profileId) : undefined;
  if (tested && (!testedProfile || testedProfile.revision !== tested.revision)) {
    pendingProfileTests.delete(result.requestId!);
    return;
  }
  const accepted = finishOperation(
    result.requestId,
    window.subtandemProviderTestStatusMessage({
      ...result,
      ...(testedProfile ? { providerKind: testedProfile.kind } : {}),
    }),
    result.ok === true ? "success" : "error",
    undefined,
    false,
  );
  if (typeof result.requestId === "string") {
    pendingProfileTests.delete(result.requestId);
    if (accepted && tested) {
      const testState: { revision: number; state: ProfileTestState } = {
        revision: tested.revision,
        state: result.ok === true ? "passed" : "failed",
      };
      profileTestStates.set(tested.profileId, testState);
      sidebarState.setProfileTest(tested.profileId, testState);
    }
  }
  const currentProfiles = [...profiles.values()];
  renderedProfilesSignature = "";
  renderProfiles(currentProfiles);
});

window.iina?.onMessage("provider:models-result", (raw: unknown) => {
  const result = raw as {
    requestId?: unknown;
    ok?: unknown;
    contextKey?: unknown;
    models?: unknown;
    category?: unknown;
    statusCode?: unknown;
  };
  if (
    !pendingModelRefresh ||
    result.requestId !== pendingModelRefresh.requestId ||
    pendingModelRefresh.contextSignature !== modelContextKey() ||
    typeof result.contextKey !== "string" ||
    typeof result.ok !== "boolean"
  )
    return;
  const credentialSource = pendingModelRefresh.credentialSource;
  const stateContextKey = pendingModelRefresh.stateContextKey;
  pendingModelRefresh = null;
  if (result.ok) {
    if (!Array.isArray(result.models) || result.models.some((model) => typeof model !== "string")) {
      setModelRefreshFeedback("error", "The model list response was incompatible.");
      return;
    }
    const value = sidebarState.snapshot.modelControl.value;
    sidebarState.setModelContext(stateContextKey, value);
    sidebarState.applyModelCatalog(stateContextKey, result.models as string[]);
    renderModelControl();
    setModelRefreshFeedback(
      "success",
      window.subtandemModelCatalogStatusMessage({
        ok: true,
        count: sidebarState.snapshot.modelControl.knownModelIds.length,
      }),
    );
    return;
  }
  const message = window.subtandemModelCatalogStatusMessage({
    ok: false,
    ...(typeof result.category === "string" ? { category: result.category } : {}),
    ...(typeof result.statusCode === "number" ? { statusCode: result.statusCode } : {}),
    credentialSource,
  });
  setModelRefreshFeedback("error", message);
});

window.iina?.onMessage("credential:state", (raw: unknown) => {
  const result = raw as {
    requestId?: string;
    state?: string;
    code?: string;
    userAction?: string;
    profileId?: string;
  };
  const ready = result.state === "ready";
  const message = window.subtandemCredentialStatusMessage(result);
  if (
    pendingProfileSave &&
    result.requestId === pendingProfileSave.requestId &&
    pendingProfileSave.contextSignature === editorContextSignature() &&
    (result.profileId === undefined || result.profileId === pendingProfileSave.profileId)
  ) {
    if (result.profileId !== undefined && result.profileId !== pendingProfileSave.profileId) return;
    credentialState.textContent = message;
    if (ready && editingProfile && editingProfile.profileId === pendingProfileSave.profileId) {
      editingProfile = { ...editingProfile, credentialConfigured: true };
      profiles.set(editingProfile.profileId, editingProfile);
      providerKey.required = false;
      document.querySelector<HTMLElement>("#credential-hint")!.textContent =
        editingProfile.kind === "claude"
          ? "Write-only. Leave blank to keep the saved Claude API key."
          : "Write-only; optional when unauthenticated. Leave blank to keep the saved API key.";
    }
    const saveMessage = sidebarState.completeProfileSave(
      result.requestId,
      ready ? "Profile and local credential saved." : profileCredentialPartialFailureMessage,
      ready,
    );
    finishOperation(result.requestId, saveMessage ?? message, ready ? "success" : "error");
    pendingProfileSave = null;
  }
  if (ready) window.iina?.postMessage("ui:ready", envelope({}));
  if (ready) requestModels("credential");
});

window.iina?.onMessage("operation:result", (raw: unknown) => {
  const result = raw as {
    requestId?: string;
    ok?: boolean;
    cancelled?: boolean;
    action?: string;
    targetLanguage?: string;
    targetLanguageRevision?: number;
    position?: number;
    committedPosition?: number;
    intentSequence?: number;
    committedRevision?: number;
  };
  if (
    result.action === "overlay-position" &&
    typeof result.requestId === "string" &&
    typeof result.intentSequence === "number" &&
    typeof result.committedRevision === "number"
  ) {
    const accepted =
      result.ok === true && typeof result.position === "number"
        ? sidebarState.finishOverlayPositionSave({
            requestId: result.requestId,
            ok: true,
            position: result.position,
            intentSequence: result.intentSequence,
            committedRevision: result.committedRevision,
          })
        : result.ok === false && typeof result.committedPosition === "number"
          ? sidebarState.finishOverlayPositionSave({
              requestId: result.requestId,
              ok: false,
              committedPosition: result.committedPosition,
              intentSequence: result.intentSequence,
              committedRevision: result.committedRevision,
            })
          : false;
    if (accepted) renderOverlayPosition();
    return;
  }
  if (result.action === "languages") {
    const matchesPendingLanguageSave = result.requestId === pendingLanguageSaveRequestId;
    if (!matchesPendingLanguageSave) return;
    let succeeded = false;
    if (
      result.ok === true &&
      typeof result.targetLanguage === "string" &&
      typeof result.targetLanguageRevision === "number" &&
      Number.isInteger(result.targetLanguageRevision) &&
      result.targetLanguageRevision > targetLanguageRevision
    ) {
      committedTargetLanguage = result.targetLanguage;
      targetLanguageRevision = result.targetLanguageRevision;
      succeeded = true;
    }
    const accepted = finishLanguageSave(result.requestId);
    if (!accepted) return;
    finishOperation(
      result.requestId,
      result.cancelled
        ? "Target language was not changed."
        : succeeded
          ? "Target language saved."
          : "Target language could not be saved. The previous target remains active.",
      result.cancelled ? "cancelled" : succeeded ? "success" : "error",
      result.cancelled ? "visible" : undefined,
    );
    return;
  }
  const message = result.cancelled
    ? "Operation cancelled. Nothing was changed."
    : result.action === "translation"
      ? enabled.checked
        ? "Translation enabled."
        : "Translation disabled."
      : result.action === "retry-preparation"
        ? result.ok === true
          ? "Subtitle preparation restarted."
          : "Retry is no longer available for this subtitle."
        : "Operation completed.";
  finishOperation(
    result.requestId,
    message,
    result.cancelled ? "cancelled" : result.ok === true ? "success" : "error",
  );
});

window.iina?.onMessage("operation:error", (raw: unknown) => {
  const result = raw as { requestId?: string };
  const languageSaveAccepted = finishLanguageSave(result.requestId);
  if (languageSaveAccepted) {
    finishOperation(
      result.requestId,
      "Target language could not be saved. The previous target remains active.",
      "error",
    );
    return;
  }
  finishOperation(
    result.requestId,
    "The operation could not be completed. Review the service settings and try again.",
    "error",
  );
  if (pendingProfileSave?.requestId === result.requestId) pendingProfileSave = null;
  if (typeof result.requestId === "string") sidebarState.cancelProfileSave(result.requestId);
});

function renderProfiles(viewProfiles: ProfileView[]): void {
  profiles.clear();
  profilesElement.replaceChildren();
  if (!viewProfiles.length) {
    profilesElement.innerHTML = '<p class="empty">No saved profiles yet.</p>';
    renderActiveFeedback();
    return;
  }
  for (const profile of viewProfiles) {
    profiles.set(profile.profileId, profile);
    const article = document.createElement("article");
    article.className = `profile${selectedProfileId === profile.profileId ? " is-selected" : ""}`;
    article.innerHTML = `<div><strong></strong><span class="profile-summary"></span><code></code></div><div class="profile-actions"></div>`;
    article.querySelector("strong")!.textContent = profile.displayName;
    article.querySelector<HTMLElement>(".profile-summary")!.textContent =
      `${providerLabels[profile.kind]}${profile.model ? ` · ${profile.model}` : ""}` +
      `${profile.proxyMode === "direct" ? " · direct" : " · macOS proxy"}` +
      `${profile.credentialConfigured ? " · key saved" : " · no key saved"}`;
    const savedProfileTestState = profileTestStates.get(profile.profileId);
    const profileTestState =
      savedProfileTestState?.revision === profile.revision
        ? savedProfileTestState.state
        : "not tested";
    const testStateElement = document.createElement("span");
    testStateElement.className = "profile-test-state";
    testStateElement.dataset.state = profileTestState;
    testStateElement.textContent = profileTestStateLabels[profileTestState];
    article.querySelector("code")!.before(testStateElement);
    article.querySelector("code")!.textContent = profile.endpoint;
    const actions = article.querySelector<HTMLElement>(".profile-actions")!;
    for (const [action, label] of [
      ["test", "Test"],
      ["select", selectedProfileId === profile.profileId ? "Selected" : "Select"],
      ["edit", "Edit"],
      ["delete", "Delete"],
    ] as const) {
      const button = document.createElement("button");
      button.type = "button";
      button.className =
        action === "select" ? "" : `secondary${action === "delete" ? " danger" : ""}`;
      button.dataset.action = action;
      button.dataset.profileId = profile.profileId;
      button.textContent = label;
      if (action === "select" && selectedProfileId === profile.profileId) button.disabled = true;
      actions.append(button);
    }
    const rowStatus = document.createElement("p");
    rowStatus.className = "operation-status profile-operation-status";
    rowStatus.dataset.profileId = profile.profileId;
    rowStatus.setAttribute("role", "status");
    rowStatus.setAttribute("aria-live", "polite");
    article.append(rowStatus);
    profilesElement.append(article);
    const regionId = `profile-row:${profile.profileId}`;
    const latestRequestId = sidebarState.snapshot.latestRequestByRegion[regionId]?.requestId;
    const latestRequest = latestRequestId
      ? sidebarState.snapshot.requests[latestRequestId]
      : undefined;
    if (latestRequest)
      setActionBusy(
        latestRequest.actionId,
        latestRequest.profileId,
        true,
        latestRequest.busyMessage ?? "",
      );
  }
  renderActiveFeedback();
}

window.iina?.onMessage("subtitle-style:state", (raw: unknown) => {
  if (sidebarState.applySubtitleStyleState(raw as SidebarSubtitleStyleAuthorityState))
    renderSubtitleStyle();
});

window.iina?.onMessage("subtitle-style:save-result", (raw: unknown) => {
  if (sidebarState.finishSubtitleStyleSave(raw as SidebarSubtitleStyleSaveResult))
    renderSubtitleStyle();
});

window.iina?.onMessage("subtitle-style:picker-result", (raw: unknown) => {
  const result = raw as {
    requestId?: string;
    outcome?: "confirmed" | "cancelled" | "unchanged" | "busy" | "failed";
    authority?: SidebarSubtitleStyleAuthorityState;
  };
  if (result.requestId === pendingColorPickerRequestId && result.authority && result.outcome) {
    const session = sidebarState.snapshot.subtitleStyle.nativeColorSession;
    if (!sidebarState.finishSubtitleColorPicker(result.requestId, result.outcome, result.authority))
      return;
    pendingColorPickerRequestId = null;
    renderSubtitleStyle();
    if (session) colorControls[session.field].button.focus();
    if (result.outcome === "unchanged") subtitleStyleError.textContent = "";
    return;
  }
  if (result.requestId !== pendingFontPickerRequestId || !result.authority) return;
  pendingFontPickerRequestId = null;
  fontButton.setAttribute("aria-busy", "false");
  sidebarState.applySubtitleStyleState(result.authority);
  renderSubtitleStyle();
  if (result.outcome === "busy") {
    subtitleStyleError.textContent = "Another subtitle style picker is already open.";
    subtitleStyleError.dataset.state = "error";
  } else if (result.outcome === "failed") {
    subtitleStyleError.textContent = "The subtitle font picker is unavailable.";
    subtitleStyleError.dataset.state = "error";
  }
});

window.iina?.onMessage("state:update", (raw: unknown) => {
  const view = raw as {
    status?: SessionStatus;
    source?: {
      format: string;
      cueCount: number;
      detectedLanguage?: string | null;
    } | null;
    cacheSize?: number;
    boundedWork?: string;
    profiles?: ProfileView[];
    selection?: { profileId: string; revision: number } | null;
    sourceIssue?: string | null;
    providerError?: SessionProviderError | null;
    sourcePreparation?: {
      state: SourcePreparationState;
      canRetry: boolean;
      canReselect: boolean;
    } | null;
    targetLanguage?: string;
    targetLanguageRevision?: number;
    targetLanguages?: Array<{ id: string; displayName: string; order: number }>;
    overlayPosition?: SidebarOverlayPositionAuthorityState;
    subtitleStyle?: SidebarSubtitleStyleAuthorityState | null;
  };
  if (view.overlayPosition && sidebarState.applyOverlayPositionState(view.overlayPosition))
    renderOverlayPosition();
  if (view.subtitleStyle && sidebarState.applySubtitleStyleState(view.subtitleStyle))
    renderSubtitleStyle();
  if (view.targetLanguages) {
    const signature = JSON.stringify(view.targetLanguages);
    if (signature !== renderedLanguageCatalogSignature) {
      const displayedTargetLanguage = targetLanguage.value;
      renderedLanguageCatalogSignature = signature;
      targetLanguage.replaceChildren();
      for (const language of [...view.targetLanguages].sort(
        (left, right) => left.order - right.order,
      )) {
        const option = document.createElement("option");
        option.value = language.id;
        option.textContent = language.displayName;
        targetLanguage.append(option);
      }
      if (
        pendingLanguageSaveRequestId &&
        Array.from(targetLanguage.options).some(
          (option) => option.value === displayedTargetLanguage,
        )
      )
        targetLanguage.value = displayedTargetLanguage;
    }
  }
  if (
    typeof view.targetLanguage === "string" &&
    typeof view.targetLanguageRevision === "number" &&
    !pendingLanguageSaveRequestId
  ) {
    committedTargetLanguage = view.targetLanguage;
    targetLanguageRevision = view.targetLanguageRevision;
    targetLanguage.value = committedTargetLanguage;
    targetLanguageHydrated = true;
    targetLanguage.disabled = false;
    targetLanguage.removeAttribute("aria-busy");
  }
  if (view.status && labels[view.status]) {
    statusMessage.textContent = labels[view.status];
    statusDot.dataset.state = view.status;
    enabled.checked = view.status !== "disabled";
    if (view.status === "partialFailure" || view.status === "serviceUnavailable") {
      const detail = safeProviderErrorDetail(view.providerError);
      if (detail) statusMessage.textContent = `${labels[view.status]} — ${detail}`;
    }
  }
  if (
    view.status === "waitingForSubtitle" &&
    view.sourceIssue &&
    sourceIssueLabels[view.sourceIssue]
  )
    statusMessage.textContent = sourceIssueLabels[view.sourceIssue]!;
  if (view.sourcePreparation && view.sourcePreparation.state !== "ready") {
    subtitleRetryAvailable = view.sourcePreparation.canRetry;
    updateSubtitleRetryControls();
    statusMessage.textContent = sourcePreparationLabels[view.sourcePreparation.state];
    statusDot.dataset.state = view.sourcePreparation.state;
  } else {
    subtitleRetryAvailable = false;
    updateSubtitleRetryControls();
  }
  if (view.source) {
    sourceSummary.hidden = false;
    document.querySelector<HTMLElement>("#source-format")!.textContent =
      view.source.format.toUpperCase();
    document.querySelector<HTMLElement>("#source-cues")!.textContent = String(view.source.cueCount);
    document.querySelector<HTMLElement>("#source-detected-language")!.textContent =
      view.source.detectedLanguage ?? "Unknown";
  } else if (view.source === null) {
    sourceSummary.hidden = true;
  }
  if (typeof view.cacheSize === "number")
    document.querySelector<HTMLElement>("#cache-size")!.textContent = `${view.cacheSize} cues`;
  if (view.boundedWork)
    document.querySelector<HTMLElement>("#work-bound")!.textContent = view.boundedWork;
  selectedProfileId = view.selection?.profileId ?? null;
  sidebarState.setProfileContext({ selectedProfileId });
  if (view.profiles) {
    const visibleProfiles = sidebarState.applyProfiles(
      view.profiles as unknown as SidebarStateProfile[],
    ) as unknown as ProfileView[];
    const signature = JSON.stringify({
      selectedProfileId,
      deletedProfileIds: sidebarState.snapshot.deletedProfileIds,
      profiles: visibleProfiles.map((profile) => [
        profile.profileId,
        profile.revision,
        profile.displayName,
        profile.kind,
        profile.endpoint,
        profile.proxyMode,
        profile.model,
        profile.credentialConfigured,
        profileTestStates.get(profile.profileId)?.revision === profile.revision
          ? profileTestStates.get(profile.profileId)!.state
          : "not tested",
      ]),
    });
    if (signature !== renderedProfilesSignature) {
      renderedProfilesSignature = signature;
      renderProfiles(visibleProfiles);
    }
    if (editingProfile)
      editingProfile = sidebarState.reconcileEditingProfile(
        editingProfile as unknown as SidebarStateProfile,
      ) as unknown as ProfileView;
  }
});

window.iina?.postMessage("ui:ready", envelope({}));
window.setInterval(() => window.iina?.postMessage("ui:poll", envelope({})), 750);
renderSubtitleStyle();
applyProviderKind();
requestModels("open");
