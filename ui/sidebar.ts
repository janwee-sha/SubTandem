type SessionStatus =
  | "disabled"
  | "waitingForSubtitle"
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

type SourcePreparationState =
  | "preparing"
  | "ready"
  | "unsupportedType"
  | "remoteUnsupported"
  | "emptyOrUnreadable"
  | "timedOut"
  | "failed"
  | "invalidated";

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
const profileDrawer = document.querySelector<HTMLElement>("#profile-drawer")!;
const profileTestStatus = document.querySelector<HTMLParagraphElement>("#profile-test-status")!;
const testProfileButton = document.querySelector<HTMLButtonElement>("#test-profile")!;
const cancelProfileButton = document.querySelector<HTMLButtonElement>("#cancel-profile")!;
const deleteProfileButton = document.querySelector<HTMLButtonElement>("#delete-profile")!;
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
const fontSizeSelect = document.querySelector<HTMLSelectElement>("#subtitle-font-size")!;
const fontButton = document.querySelector<HTMLButtonElement>("#subtitle-font-family")!;
const fontBold = document.querySelector<HTMLInputElement>("#subtitle-font-bold")!;
const fontItalic = document.querySelector<HTMLInputElement>("#subtitle-font-italic")!;
const fontStatus = document.querySelector<HTMLParagraphElement>("#subtitle-font-status")!;
const borderColorButton = document.querySelector<HTMLButtonElement>("#subtitle-border-color")!;
const borderColorSwatch = borderColorButton.querySelector<HTMLElement>(".subtitle-color-swatch")!;
const borderWidthSelect = document.querySelector<HTMLSelectElement>("#subtitle-border-width")!;
const backgroundColorButton = document.querySelector<HTMLButtonElement>(
  "#subtitle-background-color",
)!;
const backgroundColorSwatch =
  backgroundColorButton.querySelector<HTMLElement>(".subtitle-color-swatch")!;
const colorPalette = document.querySelector<HTMLElement>("#subtitle-color-palette")!;
const subtitleColorGrid = colorPalette.querySelector<HTMLElement>(".subtitle-color-grid")!;
const subtitleShowColors = document.querySelector<HTMLButtonElement>("#subtitle-show-colors")!;
const subtitleStyleError = document.querySelector<HTMLParagraphElement>("#subtitle-style-error")!;
const operationAnnouncer = document.querySelector<HTMLParagraphElement>("#operation-announcer")!;
const appElement = document.querySelector<HTMLElement>("#app")!;
const profileDeleteBackdrop = document.querySelector<HTMLElement>("#profile-delete-backdrop")!;
const profileDeleteDialog = document.querySelector<HTMLElement>("#profile-delete-dialog")!;
const profileDeleteTitle = document.querySelector<HTMLHeadingElement>("#profile-delete-title")!;
const profileDeleteDescription = document.querySelector<HTMLParagraphElement>(
  "#profile-delete-description",
)!;
const profileDeleteStatus = document.querySelector<HTMLParagraphElement>("#profile-delete-status")!;
const confirmProfileDeleteButton =
  document.querySelector<HTMLButtonElement>("#confirm-profile-delete")!;
const cancelProfileDeleteButton =
  document.querySelector<HTMLButtonElement>("#cancel-profile-delete")!;

const subtitleColorFamilies = [
  ["Red", 0],
  ["Orange", 28],
  ["Yellow", 54],
  ["Green", 112],
  ["Teal", 166],
  ["Cyan", 190],
  ["Blue", 218],
  ["Indigo", 246],
  ["Purple", 278],
  ["Pink", 326],
] as const;
const subtitleColorTones = [
  ["Darkest", 18],
  ["Dark", 30],
  ["Deep", 42],
  ["Medium", 54],
  ["Light", 68],
  ["Lightest", 82],
] as const;

function subtitlePaletteRgb(hue: number, saturation: number, lightness: number): number[] {
  const chroma = (1 - Math.abs(2 * lightness - 1)) * saturation;
  const segment = hue / 60;
  const secondary = chroma * (1 - Math.abs((segment % 2) - 1));
  const [red, green, blue] =
    segment < 1
      ? [chroma, secondary, 0]
      : segment < 2
        ? [secondary, chroma, 0]
        : segment < 3
          ? [0, chroma, secondary]
          : segment < 4
            ? [0, secondary, chroma]
            : segment < 5
              ? [secondary, 0, chroma]
              : [chroma, 0, secondary];
  const match = lightness - chroma / 2;
  return [red, green, blue].map((channel) => Math.round((channel + match) * 255));
}

function populateSubtitleColorGrid(): void {
  for (const [toneName, lightnessPercent] of subtitleColorTones) {
    for (const [familyName, hue] of subtitleColorFamilies) {
      const [r, g, b] = subtitlePaletteRgb(hue, 0.82, lightnessPercent / 100);
      const name = `${toneName} ${familyName}`;
      const button = document.createElement("button");
      button.type = "button";
      button.setAttribute("role", "radio");
      button.setAttribute("aria-checked", "false");
      button.setAttribute("aria-label", name);
      button.dataset.colorName = name;
      button.dataset.rgba = `${r},${g},${b},255`;
      const swatch = document.createElement("span");
      swatch.className = "palette-swatch";
      swatch.setAttribute("aria-hidden", "true");
      swatch.style.setProperty("--subtitle-swatch", `rgb(${r} ${g} ${b})`);
      button.append(swatch);
      subtitleColorGrid.append(button);
    }
  }
}

populateSubtitleColorGrid();

const providerDrafts: Record<
  ProviderKind,
  { endpoint: string; model: string; proxyMode: "system" | "direct" }
> = {
  openai: { endpoint: "https://api.openai.com/v1", model: "", proxyMode: "direct" },
  claude: { endpoint: "https://api.anthropic.com", model: "", proxyMode: "direct" },
  deepseek: { endpoint: "https://api.deepseek.com", model: "", proxyMode: "direct" },
  ollama: { endpoint: "http://127.0.0.1:11434", model: "", proxyMode: "direct" },
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
const profileCardInteractions = new ProfileCardInteractionCoordinator();
const profileDeleteDialogInteractions = new ProfileDeleteDialogInteractionCoordinator();
const profileUpdatedSelectionMessage = "Profile updated. Enable it when you are ready.";
const profileCredentialPartialFailureMessage =
  "Profile saved, but the credential was not saved. Review the credential status and retry the profile update.";
const profileRows = new Map<string, HTMLElement>();
let newProfileRow: HTMLElement | null = null;
const pendingOperations = new Set<string>();
const profileActivationTimeouts = new Map<string, number>();
let activeProviderKind: ProviderKind = "openai";
let editingProfile: ProfileView | null = null;
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
let lastSessionPresentationSignature: string | null = null;
let targetLanguageRevision = 1;
let committedTargetLanguage = "zh-Hans";
let targetLanguageHydrated = false;
let pendingLanguageSaveRequestId: string | null = null;
let renderedLanguageCatalogSignature = "";
let subtitleRetryAvailable = false;
let subtitleDetailsVisible = false;
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
let deleteDialogRestoreIndex = -1;
let deleteDialogProfileId: string | null = null;
let backgroundTabStops: Array<{ element: HTMLElement; tabIndex: string | null }> = [];

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

function setDeleteDialogBackgroundShielded(shielded: boolean): void {
  if (shielded) {
    if (backgroundTabStops.length) return;
    backgroundTabStops = Array.from(
      appElement.querySelectorAll<HTMLElement>("button,input,select,textarea,a,[tabindex]"),
    ).map((element) => ({ element, tabIndex: element.getAttribute("tabindex") }));
    for (const { element } of backgroundTabStops) element.setAttribute("tabindex", "-1");
    appElement.setAttribute("aria-hidden", "true");
    return;
  }
  appElement.removeAttribute("aria-hidden");
  for (const { element, tabIndex } of backgroundTabStops) {
    if (tabIndex === null) element.removeAttribute("tabindex");
    else element.setAttribute("tabindex", tabIndex);
  }
  backgroundTabStops = [];
}

function deleteButtonForProfile(profileId: string): HTMLButtonElement | null {
  return (
    Array.from(
      profilesElement.querySelectorAll<HTMLButtonElement>('button[data-action="delete"]'),
    ).find((button) => button.dataset.profileId === profileId) ?? null
  );
}

function focusAfterDeleteDialog(): void {
  if (deleteDialogProfileId) {
    const retainedButton = deleteButtonForProfile(deleteDialogProfileId);
    if (retainedButton) {
      retainedButton.focus();
      return;
    }
  }
  const target = profileDeleteDialogInteractions.focusAfterRemoval(deleteDialogRestoreIndex, [
    ...profiles.keys(),
  ]);
  if (target.kind === "profile-delete") deleteButtonForProfile(target.profileId)?.focus();
  else profileName.focus();
}

function closeDeleteDialog(restoreFocus: boolean): void {
  profileDeleteBackdrop.hidden = true;
  setDeleteDialogBackgroundShielded(false);
  if (restoreFocus) focusAfterDeleteDialog();
  deleteDialogRestoreIndex = -1;
  deleteDialogProfileId = null;
}

function renderDeleteDialog(): void {
  const confirmation = sidebarState.snapshot.deleteConfirmation;
  if (!confirmation) {
    if (!profileDeleteBackdrop.hidden) closeDeleteDialog(true);
    return;
  }
  profileDeleteTitle.textContent = `Delete ${confirmation.displayName}?`;
  profileDeleteDescription.textContent = "The profile will be permanently deleted.";
  const deleting = confirmation.phase === "deleting";
  confirmProfileDeleteButton.disabled = deleting;
  cancelProfileDeleteButton.disabled = deleting;
  confirmProfileDeleteButton.setAttribute("aria-busy", String(deleting));
  profileDeleteStatus.dataset.state = deleting ? "busy" : "";
  profileDeleteStatus.textContent = deleting ? "Deleting…" : "";
  if (profileDeleteBackdrop.hidden) {
    setDeleteDialogBackgroundShielded(true);
    profileDeleteBackdrop.hidden = false;
    cancelProfileDeleteButton.focus();
  }
}

function openDeleteDialog(profile: ProfileView): void {
  if (
    !sidebarState.openDeleteConfirmation({
      profileId: profile.profileId,
      expectedRevision: profile.revision,
      displayName: profile.displayName,
    })
  )
    return;
  deleteDialogRestoreIndex = [...profiles.keys()].indexOf(profile.profileId);
  deleteDialogProfileId = profile.profileId;
  renderDeleteDialog();
}

function cancelDeleteDialog(): void {
  if (!sidebarState.cancelDeleteConfirmation()) return;
  closeDeleteDialog(true);
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
  { button: HTMLButtonElement; swatch: HTMLElement; label: string }
> = {
  fontColor: {
    button: fontColorButton,
    swatch: fontColorSwatch,
    label: "Font Color",
  },
  borderColor: {
    button: borderColorButton,
    swatch: borderColorSwatch,
    label: "Border Color",
  },
  backgroundColor: {
    button: backgroundColorButton,
    swatch: backgroundColorSwatch,
    label: "Background Color",
  },
};

function renderColorControl(field: SidebarSubtitleColorField, color: SidebarRgbaColor): void {
  const control = colorControls[field];
  control.swatch.style.setProperty("--subtitle-swatch", rgbaCss(color));
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
  fontStatus.textContent = state.fontResolution.fallbackActive
    ? `${state.fontResolution.preferredFamily} is unavailable; using System Font.`
    : "";
  fontStatus.dataset.state = state.fontResolution.fallbackActive ? "error" : "";
  for (const field of ["fontColor", "borderColor", "backgroundColor"] as const) {
    const control = colorControls[field];
    control.button.setAttribute("aria-busy", String(state.feedbackByField[field] === "saving"));
    control.button.setAttribute("aria-expanded", String(state.colorTarget === field));
  }
  borderWidthSelect.setAttribute(
    "aria-busy",
    String(state.feedbackByField.borderWidth === "saving"),
  );
  for (const [field, control] of [
    ["fontSize", fontSizeSelect],
    ["bold", fontBold],
    ["italic", fontItalic],
  ] as const) {
    control.setAttribute("aria-busy", String(state.feedbackByField[field] === "saving"));
  }
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
  if (actionId === "test") return testProfileButton;
  if (actionId === "delete") return deleteProfileButton;
  if (actionId === "retry-preparation") return retrySubtitleButton;
  if (!profileId) return null;
  return (
    Array.from(profilesElement.querySelectorAll<HTMLButtonElement>("button[data-action]")).find(
      (button) => button.dataset.action === actionId && button.dataset.profileId === profileId,
    ) ?? null
  );
}

function idleLabelForAction(actionId: string): string {
  if (actionId === "save-profile") return "Save";
  if (actionId === "retry-preparation") return "Retry";
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
  control.disabled = busy;
  if (busy) control.setAttribute("aria-busy", "true");
  else control.removeAttribute("aria-busy");
  if (actionId === "test") return;
  if (control instanceof HTMLButtonElement) {
    const label = control.querySelector<HTMLElement>(".profile-action-label");
    if (label) label.textContent = busy ? busyLabel : idleLabelForAction(actionId);
    else control.textContent = busy ? busyLabel : idleLabelForAction(actionId);
  }
}

function updateSubtitleRetryControls(): void {
  if (!subtitleDetailsVisible) {
    sourcePreparationControls.hidden = true;
    retrySubtitleButton.hidden = true;
    return;
  }
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
  const visibleState = state.validationError ? "error" : state.refreshState;
  if (visibleState === "idle") delete modelCatalogStatus.dataset.state;
  else modelCatalogStatus.dataset.state = visibleState;
  modelCatalogStatus.textContent = state.validationError ?? state.refreshMessage;
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
  fixedRequestId?: string,
): string {
  const requestId = fixedRequestId ?? nextRequestId();
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

function clearDrawerTestFeedback(): void {
  setActionBusy("test", undefined, false);
  delete profileTestStatus.dataset.state;
  profileTestStatus.textContent = "";
}

function cancelActiveDrawerTest(): void {
  const requestId = sidebarState.cancelDrawerTest();
  clearDrawerTestFeedback();
  if (!requestId) return;
  window.iina?.postMessage("provider:test-cancel", envelope({ testRequestId: requestId }));
}

function invalidateDrawerTestField(credential = false): void {
  const requestId = sidebarState.snapshot.drawer.test?.requestId ?? null;
  const changed = credential
    ? sidebarState.changeDrawerCredential()
    : sidebarState.changeDrawerTestField();
  if (!changed) return;
  clearDrawerTestFeedback();
  if (!requestId) return;
  window.iina?.postMessage("provider:test-cancel", envelope({ testRequestId: requestId }));
}

function reconcileDrawerAfterAuthority(previousTest: SidebarDrawerTestState | null): void {
  const drawer = sidebarState.snapshot.drawer;
  if (previousTest && drawer.test?.requestId !== previousTest.requestId) {
    window.iina?.postMessage(
      "provider:test-cancel",
      envelope({ testRequestId: previousTest.requestId }),
    );
    clearDrawerTestFeedback();
  }
  if (drawer.validity === "conflict") {
    invalidatePendingModelRefresh();
    providerKey.value = "";
    draftCredentialEpoch += 1;
  }
  if (drawer.mode === "closed") {
    editingProfile = null;
    providerKey.value = "";
    sidebarState.setProfileContext({ credentialDisplayProfileId: null });
  }
  renderDrawerAvailability();
}

function validModelEndpoint(): boolean {
  try {
    normalizeProviderEndpoint(providerKind.value as ProviderKind, providerEndpoint.value);
    return true;
  } catch {
    return false;
  }
}

function canUseSavedDraftCredential(): boolean {
  const drawer = sidebarState.snapshot.drawer;
  const source = drawer.sourceProfile;
  if (
    !editingProfile?.credentialConfigured ||
    drawer.validity !== "current" ||
    !source ||
    source.profileId !== editingProfile.profileId ||
    source.profileRevision !== editingProfile.revision ||
    source.endpointFingerprint !== editingProfile.endpointFingerprint
  )
    return false;
  return sameProviderService(editingProfile, {
    kind: providerKind.value as ProviderKind,
    endpoint: providerEndpoint.value,
    proxyMode: providerProxyMode.value === "direct" ? "direct" : "system",
  });
}

function modelRefreshPayload(trigger: "open" | "endpoint" | "profile" | "credential" | "manual") {
  const endpoint = providerEndpoint.value.trim();
  const source = sidebarState.snapshot.drawer.sourceProfile;
  return {
    trigger,
    kind: providerKind.value,
    endpoint,
    proxyMode: providerProxyMode.value,
    ...(source ? { ...source } : {}),
  };
}

function requestModels(trigger: "open" | "endpoint" | "profile" | "credential" | "manual"): void {
  if (!validModelEndpoint() || sidebarState.snapshot.drawer.validity !== "current") return;
  const contextSignature = modelContextKey();
  if (
    trigger !== "manual" &&
    trigger !== "credential" &&
    pendingModelRefresh?.contextSignature === contextSignature &&
    pendingModelRefresh.trigger !== "manual"
  )
    return;
  invalidatePendingModelRefresh();
  const requestId = nextRequestId();
  const enteredApiKey = providerKey.value;
  const usesDraftCredential = trigger === "manual" && Boolean(enteredApiKey.trim());
  const matchesSaved = canUseSavedDraftCredential();
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
          ...(sidebarState.snapshot.drawer.sourceProfile
            ? { sourceProfile: sidebarState.snapshot.drawer.sourceProfile }
            : {}),
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
  window.iina?.postMessage(
    "provider:models-cancel",
    envelope({ modelRequestId: pending.requestId }),
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
  document.querySelector<HTMLElement>("#credential-hint")!.textContent =
    editingProfile?.kind === kind && editingProfile.credentialConfigured
      ? "Write-only. Leave blank to keep the saved API key."
      : "Write-only; optional when unauthenticated. Enter a key if the service requires one.";
  setModelContext(providerDrafts[kind].model);
  updateRequestUrl();
}

providerKind.addEventListener("change", () => {
  invalidateDrawerTestField();
  cancelPendingProfileSaveForContextChange();
  invalidatePendingModelRefresh();
  saveActiveDraft();
  draftCredentialEpoch += 1;
  providerKey.value = "";
  applyProviderKind();
  requestModels("profile");
});
providerEndpoint.addEventListener("input", () => {
  invalidateDrawerTestField();
  cancelPendingProfileSaveForContextChange();
  updateRequestUrl();
  scheduleEndpointModelRefresh();
});
providerProxyMode.addEventListener("change", () => {
  invalidateDrawerTestField();
  cancelPendingProfileSaveForContextChange();
  invalidatePendingModelRefresh();
  setModelContext(sidebarState.snapshot.modelControl.value);
  requestModels("profile");
});
refreshModelsButton.addEventListener("click", () => requestModels("manual"));
window.bindSubTandemModelControls({
  state: sidebarState,
  modelSelect: providerModelSelect,
  customModelInput: providerModel,
  cancelPendingSave: cancelPendingProfileSaveForContextChange,
  renderModelControl,
  renderModelFeedback,
});
providerModelSelect.addEventListener("change", () => invalidateDrawerTestField());
providerModel.addEventListener("input", () => invalidateDrawerTestField());
providerKey.addEventListener("input", () => {
  invalidateDrawerTestField(true);
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

function resetProviderDrafts(): void {
  providerDrafts.openai = {
    endpoint: "https://api.openai.com/v1",
    model: "",
    proxyMode: "direct",
  };
  providerDrafts.claude = {
    endpoint: "https://api.anthropic.com",
    model: "",
    proxyMode: "direct",
  };
  providerDrafts.deepseek = {
    endpoint: "https://api.deepseek.com",
    model: "",
    proxyMode: "direct",
  };
  providerDrafts.ollama = {
    endpoint: "http://127.0.0.1:11434",
    model: "",
    proxyMode: "direct",
  };
}

function clearProfileDrawer(focus = true): void {
  if (sidebarState.snapshot.drawer.savePhase) return;
  cancelActiveDrawerTest();
  cancelPendingProfileSaveForContextChange();
  invalidatePendingModelRefresh();
  const target = sidebarState.closeProfileDrawer();
  editingProfile = null;
  draftCredentialEpoch += 1;
  providerKey.value = "";
  profileTestStatus.textContent = "";
  sidebarState.setProfileContext({ credentialDisplayProfileId: null });
  profileDrawer.hidden = true;
  profileDrawer.removeAttribute("aria-labelledby");
  profilesElement.after(profileDrawer);
  renderProfiles([...profiles.values()]);
  if (!focus || !target) return;
  if (target.focus === "new") newProfileButton.focus();
  else
    profileRows
      .get(target.profileId ?? "")
      ?.querySelector<HTMLElement>(".profile-disclosure")
      ?.focus();
}

function loadEditor(profile: ProfileView, preservePendingSave = false): void {
  if (preservePendingSave) {
    const created = !profiles.has(profile.profileId);
    profiles.set(profile.profileId, profile);
    editingProfile = profile;
    sidebarState.setProfileContext({ credentialDisplayProfileId: profile.profileId });
    deleteProfileButton.hidden = false;
    renderProfiles(
      created
        ? [
            profile,
            ...[...profiles.values()].filter((item) => item.profileId !== profile.profileId),
          ]
        : [...profiles.values()],
    );
    return;
  }
  if (!preservePendingSave) {
    if (sidebarState.snapshot.drawer.savePhase) return;
    cancelActiveDrawerTest();
    cancelPendingProfileSaveForContextChange();
    invalidatePendingModelRefresh();
  }
  const activation = preservePendingSave
    ? { changed: false, closed: false }
    : sidebarState.openProfileDrawer(profile.profileId);
  if (activation.closed) {
    editingProfile = null;
    providerKey.value = "";
    mountProfileDrawer();
    profileRows.get(profile.profileId)?.querySelector<HTMLElement>(".profile-disclosure")?.focus();
    return;
  }
  if (
    !activation.changed &&
    editingProfile?.profileId === profile.profileId &&
    !preservePendingSave
  )
    return;
  resetProviderDrafts();
  editingProfile = profile;
  draftCredentialEpoch += 1;
  providerKey.value = "";
  sidebarState.setProfileContext({ credentialDisplayProfileId: profile.profileId });
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
  providerKey.placeholder = profile.credentialConfigured
    ? "Leave blank to keep saved key"
    : "Not shown after saving";
  deleteProfileButton.hidden = false;
  saveProfileButton.textContent = "Save";
  mountProfileDrawer();
  if (!preservePendingSave) requestModels("profile");
}

function openNewProfile(): void {
  if (sidebarState.snapshot.drawer.savePhase) return;
  if (sidebarState.snapshot.drawer.mode === "new") {
    sidebarState.openNewProfileDrawer();
    profileName.focus();
    profileDrawer.scrollIntoView({ block: "nearest" });
    return;
  }
  cancelActiveDrawerTest();
  cancelPendingProfileSaveForContextChange();
  invalidatePendingModelRefresh();
  sidebarState.openNewProfileDrawer();
  resetProviderDrafts();
  editingProfile = null;
  draftCredentialEpoch += 1;
  providerKey.value = "";
  providerKind.value = "openai";
  activeProviderKind = "openai";
  sidebarState.setProfileContext({ credentialDisplayProfileId: null });
  sidebarState.resetProfileName("OpenAI");
  profileName.value = sidebarState.snapshot.profileName.value;
  providerKey.placeholder = "Not shown after saving";
  deleteProfileButton.hidden = true;
  saveProfileButton.textContent = "Save";
  applyProviderKind();
  renderProfiles([...profiles.values()]);
  profileName.focus();
  profileDrawer.scrollIntoView({ block: "nearest" });
}

function resetEditor(): void {
  clearProfileDrawer(false);
}

function setProfileSaveLocked(locked: boolean): void {
  for (const control of Array.from(
    profileDrawer.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLButtonElement>(
      "input,select,button",
    ),
  ))
    control.disabled = locked;
  newProfileButton.disabled = locked;
  for (const disclosure of profileRows.values())
    disclosure
      .querySelector<HTMLElement>(".profile-disclosure")
      ?.setAttribute("aria-disabled", String(locked));
  newProfileRow
    ?.querySelector<HTMLElement>(".profile-disclosure")
    ?.setAttribute("aria-disabled", String(locked));
  if (!locked) renderDrawerAvailability();
}

function finishSuccessfulProfileSave(profile: ProfileView): void {
  const created = !profiles.has(profile.profileId);
  profiles.set(profile.profileId, profile);
  editingProfile = null;
  providerKey.value = "";
  setProfileSaveLocked(false);
  renderProfiles(
    created
      ? [profile, ...[...profiles.values()].filter((item) => item.profileId !== profile.profileId)]
      : [...profiles.values()],
  );
  profileRows.get(profile.profileId)?.querySelector<HTMLElement>(".profile-disclosure")?.focus();
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

function focusActiveSubtitleStylePicker(): void {
  window.iina?.postMessage("subtitle-style:picker-focus", envelope({}));
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

document.addEventListener("pointerdown", (event) => {
  if (colorPalette.hidden || !(event.target instanceof Element)) return;
  if (
    colorPalette.contains(event.target) ||
    event.target.closest<HTMLButtonElement>(".subtitle-color-trigger")
  )
    return;
  closeColorPalette(false);
});

window.addEventListener("blur", () => {
  if (!colorPalette.hidden) closeColorPalette(false);
});

subtitleShowColors.addEventListener("click", () => {
  const colorTarget = sidebarState.snapshot.subtitleStyle.colorTarget;
  if (!colorTarget) return;
  const requestId = nextRequestId();
  const started = pendingColorPickerRequestId
    ? sidebarState.restartSubtitleColorPicker(requestId, colorTarget)
    : sidebarState.beginSubtitleColorPicker(requestId, colorTarget);
  if (!started) return;
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
  if (pendingFontPickerRequestId) {
    focusActiveSubtitleStylePicker();
    return;
  }
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

testProfileButton.addEventListener("click", () => {
  const drawer = sidebarState.snapshot.drawer;
  if (drawer.mode === "closed" || drawer.validity !== "current") return;
  if (!validModelEndpoint()) {
    profileTestStatus.dataset.state = "error";
    profileTestStatus.textContent = "Enter a valid HTTP(S) service endpoint before testing.";
    providerEndpoint.focus();
    return;
  }
  const model = sidebarState.snapshot.modelControl.value.trim();
  if (!model) {
    sidebarState.setModelRequiredError(
      "Refresh models and choose one, or enter a custom model ID before testing.",
    );
    renderModelFeedback();
    providerModel.focus();
    return;
  }
  const enteredApiKey = providerKey.value.trim();
  const credential = enteredApiKey
    ? { source: "entered" as const, apiKey: enteredApiKey }
    : canUseSavedDraftCredential()
      ? { source: "saved" as const }
      : { source: "none" as const };
  const requestId = nextRequestId();
  const started = sidebarState.beginDrawerTest(requestId);
  if (!started) return;
  profileTestStatus.dataset.state = "busy";
  profileTestStatus.textContent = "Testing…";
  setActionBusy("test", undefined, true);
  window.iina?.postMessage(
    "provider:test",
    envelope(
      {
        drawerId: started.drawerId,
        draftRevision: started.draftRevision,
        kind: providerKind.value,
        endpoint: providerEndpoint.value.trim(),
        proxyMode: providerProxyMode.value,
        model,
        ...(drawer.sourceProfile ? { sourceProfile: drawer.sourceProfile } : {}),
        credential,
      },
      requestId,
    ),
  );
});

saveProfileButton.addEventListener("click", () => {
  cancelPendingProfileSaveForContextChange();
  const model = sidebarState.modelForSave();
  if (!model) {
    sidebarState.setModelRequiredError(
      "Refresh models and choose one, or enter a custom model ID.",
    );
    renderModelFeedback();
    providerModel.focus();
    return;
  }
  cancelActiveDrawerTest();
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
  setProfileSaveLocked(true);
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

newProfileButton.addEventListener("click", openNewProfile);
cancelProfileButton.addEventListener("click", () => clearProfileDrawer());
deleteProfileButton.addEventListener("click", () => {
  if (editingProfile) openDeleteDialog(editingProfile);
});

cancelProfileDeleteButton.addEventListener("click", cancelDeleteDialog);

confirmProfileDeleteButton.addEventListener("click", () => {
  const requestId = nextRequestId();
  const target = sidebarState.beginProfileDelete(requestId);
  if (!target) {
    renderDeleteDialog();
    return;
  }
  cancelActiveDrawerTest();
  renderDrawerAvailability();
  beginOperation(
    `profile-row:${target.profileId}`,
    "delete",
    "Deleting…",
    target.profileId,
    target.expectedRevision,
    requestId,
  );
  renderDeleteDialog();
  window.iina?.postMessage("profile:delete-request", envelope(target, requestId));
});

profileDeleteDialog.addEventListener("keydown", (event) => {
  const confirmation = sidebarState.snapshot.deleteConfirmation;
  if (!confirmation) return;
  if (profileDeleteDialogInteractions.shouldCancel(event.key, confirmation.phase === "deleting")) {
    event.preventDefault();
    cancelDeleteDialog();
    return;
  }
  if (event.key !== "Tab") return;
  const controls = [confirmProfileDeleteButton, cancelProfileDeleteButton].filter(
    (button) => !button.disabled,
  );
  if (!controls.length) {
    event.preventDefault();
    return;
  }
  event.preventDefault();
  const currentIndex = controls.indexOf(document.activeElement as HTMLButtonElement);
  controls[
    profileDeleteDialogInteractions.nextFocusIndex(currentIndex, controls.length, event.shiftKey)
  ]?.focus();
});

const profileScrollPosition = (): number => document.documentElement.scrollTop;
const selectionCollapsed = (): boolean => window.getSelection()?.isCollapsed !== false;

profilesElement.addEventListener("pointerdown", (event) => {
  const entry = (event.target as HTMLElement).closest<HTMLElement>(".profile-details");
  if (!entry) return;
  profileCardInteractions.beginPointer({
    profileId: entry.dataset.profileId ?? "",
    clientX: event.clientX,
    clientY: event.clientY,
    scrollPosition: profileScrollPosition(),
    controlAncestor: Boolean(
      (event.target as HTMLElement).closest("button,input,select,textarea,a") &&
      (event.target as HTMLElement).closest("button,input,select,textarea,a") !== entry,
    ),
    selectionCollapsed: selectionCollapsed(),
    detail: event.detail,
    primary: event.button === 0 && event.isPrimary,
  });
});

profilesElement.addEventListener("pointerup", (event) => {
  const profileId = profileCardInteractions.finishPointer({
    clientX: event.clientX,
    clientY: event.clientY,
    scrollPosition: profileScrollPosition(),
    selectionCollapsed: selectionCollapsed(),
  });
  const profile = profileId ? profiles.get(profileId) : null;
  if (profile) loadEditor(profile);
});

profilesElement.addEventListener("pointercancel", () => profileCardInteractions.cancel());
window.addEventListener("scroll", () => profileCardInteractions.cancel(), true);

profilesElement.addEventListener("keydown", (event) => {
  const entry = (event.target as HTMLElement).closest<HTMLElement>(".profile-details");
  if (!entry) return;
  const profileId = profileCardInteractions.activateKey(
    entry.dataset.profileId ?? "",
    event.key,
    Boolean(
      (event.target as HTMLElement).closest("button,input,select,textarea,a") &&
      (event.target as HTMLElement).closest("button,input,select,textarea,a") !== entry,
    ),
  );
  const profile = profileId ? profiles.get(profileId) : null;
  if (!profile) return;
  event.preventDefault();
  loadEditor(profile);
});

profilesElement.addEventListener("change", (event) => {
  const activation = (event.target as HTMLElement).closest<HTMLInputElement>(
    'input[data-action="activation"]',
  );
  if (!activation || activation.disabled) return;
  const profile = profiles.get(activation.dataset.profileId ?? "");
  const authority = sidebarState.snapshot.profileAuthority;
  if (!profile || !authority) return;
  const enabled = activation.checked;
  const requestId = nextRequestId();
  if (!sidebarState.beginProfileActivation(requestId, profile.profileId, enabled)) return;
  renderProfileActivationControls();
  profileActivationTimeouts.set(
    requestId,
    window.setTimeout(() => {
      profileActivationTimeouts.delete(requestId);
      if (!sidebarState.expireProfileActivation(requestId)) return;
      renderProfileActivationControls();
    }, 8_000),
  );
  window.iina?.postMessage(
    "profile-activation:set",
    envelope(
      {
        authorityId: authority.authorityId,
        profileId: profile.profileId,
        profileRevision: profile.revision,
        endpointFingerprint: profile.endpointFingerprint,
        enabled,
      },
      requestId,
    ),
  );
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
    endpointFingerprint: result.profile.endpointFingerprint,
    selectionInvalidated: result.selectionInvalidated === true,
  });
  if (!transition.accepted) return;
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
    finishSuccessfulProfileSave(result.profile);
  }
  window.iina?.postMessage("ui:ready", envelope({}));
});

window.iina?.onMessage("profile-activation:state", (raw: unknown) => {
  if (!sidebarState.applyProfileAuthority(raw as SidebarProfileAuthority)) return;
  renderedProfilesSignature = "";
  renderProfiles(sidebarState.snapshot.profiles as unknown as ProfileView[]);
});

window.iina?.onMessage("profile-activation:result", (raw: unknown) => {
  const value = raw as SidebarProfileActivationResult;
  const timeout = profileActivationTimeouts.get(value.requestId);
  if (timeout !== undefined) {
    window.clearTimeout(timeout);
    profileActivationTimeouts.delete(value.requestId);
  }
  const result = sidebarState.finishProfileActivation(value);
  if (!result.accepted) return;
  renderedProfilesSignature = "";
  renderProfiles(sidebarState.snapshot.profiles as unknown as ProfileView[]);
});

window.iina?.onMessage("profile:deleted", (raw: unknown) => {
  const result = raw as { requestId?: string; profileId?: string };
  if (typeof result.requestId !== "string" || typeof result.profileId !== "string") return;
  const pendingDelete =
    pendingOperations.has(result.requestId) &&
    sidebarState.snapshot.requests[result.requestId]?.actionId === "delete" &&
    sidebarState.snapshot.requests[result.requestId]?.profileId === result.profileId;
  sidebarState.deleteSucceeded({
    requestId: result.requestId,
    profileId: result.profileId,
    message: "Profile and saved credential deleted.",
  });
  if (editingProfile?.profileId === result.profileId) resetEditor();
  if (pendingDelete) setActionBusy("delete", result.profileId, false);
  pendingOperations.delete(result.requestId);
  renderedProfilesSignature = "";
  renderProfiles(sidebarState.snapshot.profiles as unknown as ProfileView[]);
  window.iina?.postMessage("ui:ready", envelope({}));
});

window.iina?.onMessage("provider:test-result", (raw: unknown) => {
  const result = raw as {
    requestId?: string;
    drawerId?: string;
    draftRevision?: number;
    ok?: boolean;
    category?: string;
    statusCode?: number;
    code?: string;
    retryable?: boolean;
    userAction?: string;
  };
  const currentTest = sidebarState.snapshot.drawer.test;
  if (
    typeof result.requestId !== "string" ||
    typeof result.drawerId !== "string" ||
    typeof result.draftRevision !== "number" ||
    !currentTest ||
    currentTest.requestId !== result.requestId ||
    currentTest.drawerId !== result.drawerId ||
    currentTest.draftRevision !== result.draftRevision
  )
    return;
  const message = window.subtandemProviderTestStatusMessage({
    ...result,
    providerKind: providerKind.value as ProviderKind,
  });
  const accepted = sidebarState.finishDrawerTest(
    result.requestId,
    result.ok === true,
    message,
    result.drawerId,
    result.draftRevision,
  );
  if (!accepted) return;
  setActionBusy("test", undefined, false);
  profileTestStatus.dataset.state =
    result.ok === true ? "success" : result.code === "TEST_INVALIDATED" ? "pending" : "error";
  profileTestStatus.textContent = message;
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
      document.querySelector<HTMLElement>("#credential-hint")!.textContent =
        "Write-only. Leave blank to keep the saved API key.";
    }
    const saveMessage = sidebarState.completeProfileSave(
      result.requestId,
      ready ? "Profile and local credential saved." : profileCredentialPartialFailureMessage,
      ready,
    );
    finishOperation(result.requestId, saveMessage ?? message, ready ? "success" : "error");
    pendingProfileSave = null;
    if (ready && editingProfile) finishSuccessfulProfileSave(editingProfile);
    else setProfileSaveLocked(false);
  }
  if (ready) window.iina?.postMessage("ui:ready", envelope({}));
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
  const failedDelete =
    typeof result.requestId === "string" &&
    sidebarState.snapshot.deleteConfirmation?.requestId === result.requestId;
  finishOperation(
    result.requestId,
    failedDelete
      ? "The Profile could not be deleted. Review the latest Profile and try again."
      : "The operation could not be completed. Review the service settings and try again.",
    "error",
  );
  if (
    failedDelete &&
    typeof result.requestId === "string" &&
    sidebarState.finishProfileDeleteFailure(result.requestId)
  ) {
    closeDeleteDialog(true);
    renderDrawerAvailability();
    return;
  }
  if (pendingProfileSave?.requestId === result.requestId) {
    pendingProfileSave = null;
    setProfileSaveLocked(false);
  }
  if (typeof result.requestId === "string") sidebarState.cancelProfileSave(result.requestId);
  renderDrawerAvailability();
});

function createProfileRow(profile: ProfileView): HTMLElement {
  const article = document.createElement("article");
  article.className = "profile";
  article.innerHTML = `<div class="profile-heading"><div class="profile-details profile-disclosure"><span class="disclosure-indicator" aria-hidden="true"></span><span class="profile-copy"><strong></strong><span class="profile-summary"></span><code></code></span></div><label class="switch profile-activation"><input type="checkbox"></label></div><p class="operation-status profile-operation-status" role="status" aria-live="polite"></p>`;
  const disclosure = article.querySelector<HTMLElement>(".profile-disclosure")!;
  disclosure.className = "profile-disclosure";
  disclosure.classList.add("profile-details");
  disclosure.tabIndex = 0;
  disclosure.setAttribute("role", "button");
  const activation = article.querySelector<HTMLInputElement>(".profile-activation input")!;
  activation.role = "switch";
  activation.dataset.action = "activation";
  updateProfileRow(article, profile);
  return article;
}

function updateProfileRow(article: HTMLElement, profile: ProfileView): void {
  const panelId = `profile-drawer-${profile.profileId}`;
  article.dataset.profileId = profile.profileId;
  const disclosure = article.querySelector<HTMLElement>(".profile-disclosure")!;
  disclosure.dataset.profileId = profile.profileId;
  disclosure.setAttribute("aria-label", `Edit ${profile.displayName}`);
  disclosure.setAttribute("aria-expanded", "false");
  disclosure.setAttribute("aria-controls", panelId);
  article.querySelector("strong")!.textContent = profile.displayName;
  article.querySelector<HTMLElement>(".profile-summary")!.textContent =
    `${providerLabels[profile.kind]}${profile.model ? ` · ${profile.model}` : ""}` +
    `${profile.proxyMode === "direct" ? " · direct" : " · macOS proxy"}` +
    `${profile.credentialConfigured ? " · key saved" : " · no key saved"}`;
  article.querySelector("code")!.textContent = profile.endpoint;
  const activation = article.querySelector<HTMLInputElement>(".profile-activation input")!;
  activation.dataset.profileId = profile.profileId;
  activation.setAttribute("aria-label", `Enable ${profile.displayName}`);
  const status = article.querySelector<HTMLParagraphElement>(".profile-operation-status")!;
  status.dataset.profileId = profile.profileId;
}

function createNewProfileRow(): HTMLElement {
  const article = document.createElement("article");
  article.className = "profile profile-new is-editing";
  article.dataset.newProfile = "true";
  article.innerHTML = `<div class="profile-heading"><div class="profile-details profile-disclosure"><span class="disclosure-indicator" aria-hidden="true"></span><span class="profile-copy"><strong>New profile</strong><span class="profile-summary">Unsaved translation service</span></span></div></div>`;
  const disclosure = article.querySelector<HTMLElement>(".profile-disclosure")!;
  disclosure.tabIndex = 0;
  disclosure.setAttribute("role", "button");
  disclosure.setAttribute("aria-label", "Close new Profile");
  disclosure.setAttribute("aria-expanded", "true");
  disclosure.setAttribute("aria-controls", "profile-drawer-new");
  disclosure.addEventListener("click", () => clearProfileDrawer());
  disclosure.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    clearProfileDrawer();
  });
  return article;
}

function mountProfileDrawer(): void {
  const drawer = sidebarState.snapshot.drawer;
  for (const [profileId, article] of profileRows) {
    const expanded = drawer.mode === "editing" && drawer.profileId === profileId;
    article.classList.toggle("is-editing", expanded);
    article
      .querySelector<HTMLElement>(".profile-disclosure")
      ?.setAttribute("aria-expanded", String(expanded));
  }
  if (drawer.mode === "closed") {
    profileDrawer.hidden = true;
    profileDrawer.removeAttribute("aria-labelledby");
    profilesElement.after(profileDrawer);
    return;
  }
  const article =
    drawer.mode === "new" ? newProfileRow : (profileRows.get(drawer.profileId ?? "") ?? null);
  if (!article) {
    profileDrawer.hidden = true;
    profilesElement.after(profileDrawer);
    return;
  }
  const disclosure = article.querySelector<HTMLElement>(".profile-disclosure")!;
  const panelId =
    drawer.mode === "new" ? "profile-drawer-new" : `profile-drawer-${drawer.profileId}`;
  profileDrawer.id = panelId;
  profileDrawer.setAttribute("aria-labelledby", disclosure.id || `${panelId}-summary`);
  if (!disclosure.id) disclosure.id = `${panelId}-summary`;
  profileDrawer.hidden = false;
  article.append(profileDrawer);
  renderDrawerAvailability();
}

function renderDrawerAvailability(): void {
  const drawer = sidebarState.snapshot.drawer;
  const unavailable = sidebarState.snapshot.profileAuthority?.ready === false;
  const conflict = drawer.validity === "conflict";
  const saving = drawer.savePhase !== null;
  const deleting = drawer.deletePhase === "deleting";
  const testing = drawer.test?.phase === "testing";
  testProfileButton.disabled = unavailable || conflict || saving || deleting || testing;
  saveProfileButton.disabled = unavailable || conflict || saving || deleting;
  deleteProfileButton.disabled = unavailable || conflict || saving || deleting;
  cancelProfileButton.disabled = saving || deleting;
  refreshModelsButton.disabled = unavailable || conflict || saving || deleting;
  newProfileButton.disabled = unavailable || saving;
  if (conflict) {
    profileEditorStatus.dataset.conflict = "true";
    profileEditorStatus.dataset.state = "error";
    profileEditorStatus.textContent =
      "This Profile changed in another window. Cancel or close it, then reopen the latest version.";
    return;
  }
  if (profileEditorStatus.dataset.conflict === "true") {
    delete profileEditorStatus.dataset.conflict;
    delete profileEditorStatus.dataset.state;
    profileEditorStatus.textContent = "";
  }
}

function renderProfileActivationControls(): void {
  for (const input of Array.from(
    profilesElement.querySelectorAll<HTMLInputElement>('input[data-action="activation"]'),
  )) {
    const profileId = input.dataset.profileId ?? "";
    const view = sidebarState.profileActivationView(profileId);
    input.checked = view.checked;
    input.disabled = view.disabled;
    input.setAttribute("aria-label", view.accessibleName);
    input.setAttribute("aria-checked", String(view.checked));
    if (view.busy) input.setAttribute("aria-busy", "true");
    else input.removeAttribute("aria-busy");
    const status = profilesElement.querySelector<HTMLParagraphElement>(
      `.profile-operation-status[data-profile-id="${profileId}"]`,
    );
    if (status && (view.error || view.readinessMessage)) {
      status.textContent = view.error ?? view.readinessMessage ?? "";
      status.dataset.state = view.error ? "error" : "pending";
    } else if (status) {
      status.textContent = "";
      delete status.dataset.state;
    }
  }
}

function renderProfiles(viewProfiles: ProfileView[]): void {
  const nextIds = new Set(viewProfiles.map((profile) => profile.profileId));
  for (const [profileId, article] of profileRows) {
    if (nextIds.has(profileId)) continue;
    article.remove();
    profileRows.delete(profileId);
  }
  profiles.clear();
  const drawer = sidebarState.snapshot.drawer;
  if (drawer.mode === "new") {
    newProfileRow ??= createNewProfileRow();
    profilesElement.append(newProfileRow);
  } else if (newProfileRow) {
    newProfileRow.remove();
    newProfileRow = null;
  }
  for (const profile of viewProfiles) {
    profiles.set(profile.profileId, profile);
    const article = profileRows.get(profile.profileId) ?? createProfileRow(profile);
    profileRows.set(profile.profileId, article);
    updateProfileRow(article, profile);
    profilesElement.append(article);
  }
  const existingEmpty = profilesElement.querySelector<HTMLElement>(":scope > .empty");
  if (!viewProfiles.length && drawer.mode !== "new") {
    const empty = existingEmpty ?? document.createElement("p");
    empty.className = "empty";
    const unavailable = sidebarState.snapshot.profileAuthority?.ready === false;
    empty.textContent = unavailable
      ? "Profiles unavailable (HELPER_UNAVAILABLE). Restart IINA."
      : "No saved profiles yet.";
    if (unavailable) empty.dataset.state = "error";
    else delete empty.dataset.state;
    profilesElement.append(empty);
  } else {
    existingEmpty?.remove();
  }
  renderActiveFeedback();
  mountProfileDrawer();
  renderProfileActivationControls();
  renderDeleteDialog();
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
    outcome?: "confirmed" | "cancelled" | "unchanged" | "focused" | "failed";
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
  if (result.outcome === "failed") {
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
    } | null;
    cacheSize?: number;
    profiles?: ProfileView[];
    profileAuthority?: SidebarProfileAuthority;
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
  if (view.profileAuthority) {
    const previousTest = sidebarState.snapshot.drawer.test;
    sidebarState.applyProfileAuthority(view.profileAuthority);
    reconcileDrawerAfterAuthority(previousTest);
  }
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
  const sessionPresentation = window.subtandemResolveSessionPresentation(view);
  if (sessionPresentation && sessionPresentation.signature !== lastSessionPresentationSignature) {
    lastSessionPresentationSignature = sessionPresentation.signature;
    statusMessage.textContent = sessionPresentation.text;
    statusDot.dataset.state = sessionPresentation.state;
  }
  if (view.status) enabled.checked = view.status !== "disabled";
  const sourceDetails = window.subtandemResolveSessionSourceDetails(view);
  subtitleDetailsVisible = sourceDetails.detailsVisible;
  subtitleRetryAvailable = sourceDetails.retryAvailable;
  if (!subtitleDetailsVisible) {
    for (const requestId of sidebarState.clearOperationRegion("subtitle-retry"))
      pendingOperations.delete(requestId);
    subtitleRetryStatus.textContent = "";
    sourcePreparationControls.hidden = true;
    retrySubtitleButton.hidden = true;
    sourceSummary.hidden = true;
  } else {
    updateSubtitleRetryControls();
  }
  if (sourceDetails.source && subtitleDetailsVisible) {
    sourceSummary.hidden = false;
    document.querySelector<HTMLElement>("#source-format")!.textContent =
      sourceDetails.source.format.toUpperCase();
    document.querySelector<HTMLElement>("#source-cues")!.textContent = String(
      sourceDetails.source.cueCount,
    );
  } else if (view.source === null || !subtitleDetailsVisible) {
    sourceSummary.hidden = true;
  }
  if (typeof view.cacheSize === "number")
    document.querySelector<HTMLElement>("#cache-size")!.textContent = `${view.cacheSize} cues`;
  if (view.profiles) {
    const previousTest = sidebarState.snapshot.drawer.test;
    const visibleProfiles = sidebarState.applyProfiles(
      view.profiles as unknown as SidebarStateProfile[],
    ) as unknown as ProfileView[];
    reconcileDrawerAfterAuthority(previousTest);
    const signature = JSON.stringify({
      profileAuthority: sidebarState.snapshot.profileAuthority,
      profileActivationRequests: sidebarState.snapshot.profileActivationRequests,
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
window.addEventListener("pagehide", () => {
  if (endpointRefreshTimer !== null) clearTimeout(endpointRefreshTimer);
  invalidatePendingModelRefresh();
  const requestId = sidebarState.cancelDrawerTest();
  if (!requestId) return;
  window.iina?.postMessage("provider:test-cancel", envelope({ testRequestId: requestId }));
});
renderSubtitleStyle();
applyProviderKind();
requestModels("open");
