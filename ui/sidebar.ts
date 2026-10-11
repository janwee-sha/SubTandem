function uiFeedback(
  messageKey: string,
  params: Record<string, string | number> = {},
): LocalizedFeedback {
  return window.subtandemLocalization.message(messageKey, params);
}

function localizedText(value: string | LocalizedFeedback | null | undefined): string {
  return typeof value === "string"
    ? value
    : (window.subtandemLocalization.feedback(value ?? null) ?? "");
}

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
  [uiFeedback("sidebar.red"), 0],
  [uiFeedback("sidebar.orange"), 28],
  [uiFeedback("sidebar.yellow"), 54],
  [uiFeedback("sidebar.green"), 112],
  [uiFeedback("sidebar.teal"), 166],
  [uiFeedback("sidebar.cyan"), 190],
  [uiFeedback("sidebar.blue"), 218],
  [uiFeedback("sidebar.indigo"), 246],
  [uiFeedback("sidebar.purple"), 278],
  [uiFeedback("sidebar.pink"), 326],
] as const;
const subtitleColorTones = [
  [uiFeedback("sidebar.darkest"), 18],
  [uiFeedback("sidebar.dark"), 30],
  [uiFeedback("sidebar.deep"), 42],
  [uiFeedback("sidebar.medium"), 54],
  [uiFeedback("sidebar.light"), 68],
  [uiFeedback("sidebar.lightest"), 82],
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
      const name = localizedText(
        uiFeedback("color.grid", {
          tone: localizedText(toneName),
          color: localizedText(familyName),
        }),
      );
      const button = document.createElement("button");
      button.type = "button";
      button.setAttribute("role", "radio");
      button.setAttribute("aria-checked", "false");
      button.setAttribute("aria-label", localizedText(name));
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

interface ProviderDraft {
  endpoint: string;
  model: string;
  proxyMode: "system" | "direct";
}

function createProviderDrafts(): Record<ProviderKind, ProviderDraft> {
  return {
    openai: { endpoint: "https://api.openai.com", model: "", proxyMode: "system" },
    claude: { endpoint: "https://api.anthropic.com", model: "", proxyMode: "system" },
    deepseek: { endpoint: "https://api.deepseek.com", model: "", proxyMode: "system" },
    ollama: { endpoint: "http://127.0.0.1:11434", model: "", proxyMode: "system" },
  };
}

const providerDrafts = createProviderDrafts();
const providerLabels: Record<ProviderKind, string> = {
  openai: "OpenAI",
  claude: "Claude",
  deepseek: "DeepSeek",
  ollama: "Ollama",
};
const modelPlaceholders: Record<ProviderKind, string> = {
  openai: "gpt-6-luna",
  claude: "claude-haiku-5-5",
  deepseek: "deepseek-flash",
  ollama: "translategemma:12b",
};
const profiles = new Map<string, ProfileView>();
const sidebarState = window.createSubTandemSidebarState();
let renderedUiAuthority: string | null = null;
let uiSnapshotReady = false;
const retiredUiAuthorities = new Set<string>();
const pendingSidebarEvents: Array<() => void> = [];
function onBusinessMessage(name: string, callback: (raw: unknown) => void): void {
  window.iina?.onMessage(name, (raw: unknown) => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return;
    const value = raw as { authorityId?: unknown; authority?: { authorityId?: unknown } };
    const authorityId = value.authorityId ?? value.authority?.authorityId;
    const apply = (): void => {
      if (typeof authorityId === "string" && authorityId !== renderedUiAuthority) return;
      callback(raw);
    };
    if (!uiSnapshotReady) {
      if (pendingSidebarEvents.length >= 128) pendingSidebarEvents.shift();
      pendingSidebarEvents.push(apply);
    } else apply();
  });
}
const profileCardInteractions = new window.ProfileCardInteractionCoordinator();
const profileDeleteDialogInteractions = new window.ProfileDeleteDialogInteractionCoordinator();
const profileRows = new Map<string, HTMLElement>();
let newProfileRow: HTMLElement | null = null;
const pendingOperations = new Set<string>();
const profileActivationTimeouts = new Map<string, number>();
const clearConfirmedProfileActivationTimeouts = (): void => {
  for (const [requestId, timeout] of profileActivationTimeouts) {
    if (sidebarState.snapshot.profileActivationRequests[requestId]) continue;
    window.clearTimeout(timeout);
    profileActivationTimeouts.delete(requestId);
  }
};
let activeProviderKind: ProviderKind = "openai";
let editingProfile: ProfileView | null = null;
let pendingProfileSave: {
  requestId: string;
  contextSignature: string;
  profileId: string | null;
  revision: number | null;
} | null = null;
const toggleProviderKey = document.querySelector<HTMLButtonElement>("#toggle-provider-key")!;
function renderCredentialVisibility(): void {
  const masked = sidebarState.snapshot.drawer.masked;
  providerKey.type = masked ? "password" : "text";
  toggleProviderKey.disabled = providerKey.value.length === 0;
  toggleProviderKey.setAttribute(
    "aria-label",
    localizedText(masked ? uiFeedback("sidebar.showAPIKey") : uiFeedback("sidebar.hideAPIKey")),
  );
  toggleProviderKey.setAttribute("aria-pressed", String(!masked));
}
toggleProviderKey.addEventListener("pointerdown", (event) => {
  event.preventDefault();
});
toggleProviderKey.addEventListener("click", () => {
  if (toggleProviderKey.disabled) return;
  const start = providerKey.selectionStart,
    end = providerKey.selectionEnd,
    direction = providerKey.selectionDirection;
  const scrollLeft = providerKey.scrollLeft;
  sidebarState.setDrawerMasked(!sidebarState.snapshot.drawer.masked);
  renderCredentialVisibility();
  if (start !== null && end !== null)
    providerKey.setSelectionRange(start, end, direction ?? "none");
  providerKey.scrollLeft = scrollLeft;
});
function clearCredentialInput(): void {
  providerKey.value = "";
  sidebarState.setDrawerMasked(true);
  renderCredentialVisibility();
}
async function readEditorCredential(): Promise<void> {
  const frozen = JSON.parse(
    JSON.stringify(sidebarState.snapshot.drawer),
  ) as SidebarProfileDrawerState;
  const load = sidebarState.snapshot.credentialLoad;
  if (!load || !frozen.drawerId || !frozen.sourceProfile || !editingProfile) return;
  const input = {
    kind: editingProfile.kind,
    endpoint: editingProfile.endpoint,
    model: editingProfile.model ?? null,
    proxyMode: editingProfile.proxyMode,
    purpose: "read-edit" as const,
    sourceProfile: frozen.sourceProfile,
    save: null,
  };
  try {
    const editor = currentCredentialEditor();
    await editor.open(frozen.drawerId, frozen.sourceProfile, load.deadlineMs);
    if (
      sidebarState.snapshot.credentialLoad?.loadId !== load.loadId ||
      Date.now() >= load.deadlineMs
    )
      return;
    if (!editor.channelId) return;
    const owner = sidebarState.beginCredentialRead(editor.channelId, frozen);
    if (!owner) return;
    let value = await editor.read(input, { ...frozen, drawerId: frozen.drawerId }, load.deadlineMs);
    if (sidebarState.acceptCredentialRead(owner, editor.channelId)) {
      providerKey.value = value;
      renderCredentialVisibility();
    }
    value = "";
  } catch {
    return;
  } finally {
    finishEditorCredentialLoad(load.loadId);
  }
}

let credentialLoadTimer: {
  loadId: string;
  timer: ReturnType<typeof setTimeout>;
  drawerId: string;
} | null = null;

function finishEditorCredentialLoad(loadId: string): void {
  if (!sidebarState.finishCredentialLoad(loadId)) return;
  if (credentialLoadTimer?.loadId === loadId) clearTimeout(credentialLoadTimer.timer);
  credentialLoadTimer = null;
  renderDrawerAvailability();
  flushAutomaticModelRefresh();
}

function cancelEditorCredentialLoad(): void {
  const pending = credentialLoadTimer;
  credentialLoadTimer = null;
  if (pending) clearTimeout(pending.timer);
  sidebarState.cancelCredentialLoad();
  if (endpointRefreshTimer !== null) clearTimeout(endpointRefreshTimer);
  endpointRefreshTimer = null;
  credentialEditor?.close();
}

function startEditorCredentialLoad(): void {
  const load = sidebarState.snapshot.credentialLoad;
  renderDrawerAvailability();
  if (!load) return;
  credentialLoadTimer = {
    loadId: load.loadId,
    drawerId: load.drawerId,
    timer: setTimeout(
      () => {
        if (sidebarState.snapshot.credentialLoad?.loadId !== load.loadId) return;
        credentialEditor?.close(load.drawerId);
        finishEditorCredentialLoad(load.loadId);
      },
      Math.max(0, load.deadlineMs - Date.now()),
    ),
  };
}

let credentialEditor: ReturnType<Window["subtandemCredentialEditor"]["create"]> | null = null;
function currentCredentialEditor() {
  if (!credentialEditor) {
    if (!window.iina || !window.subtandemCredentialEditor)
      throw new Error("CREDENTIAL_CHANNEL_UNAVAILABLE");
    credentialEditor = window.subtandemCredentialEditor.create(window.iina);
  }
  return credentialEditor;
}
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
const drawerTestTimeoutMs = 10_000;
let drawerRuntimeTick: ReturnType<typeof setInterval> | null = null;
let pendingDrawerTestDeadline: {
  requestId: string;
  expiresAtMs: number;
  timer: ReturnType<typeof setTimeout>;
} | null = null;
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
  profileDeleteTitle.textContent = localizedText(
    uiFeedback("profile.deleteTitle", { name: confirmation.displayName }),
  );
  profileDeleteDescription.textContent = localizedText(
    uiFeedback("sidebar.theProfileWillBePermanentlyDeleted"),
  );
  const deleting = confirmation.phase === "deleting";
  confirmProfileDeleteButton.disabled = deleting;
  cancelProfileDeleteButton.disabled = deleting;
  confirmProfileDeleteButton.setAttribute("aria-busy", String(deleting));
  profileDeleteStatus.dataset.state = deleting ? "busy" : "";
  profileDeleteStatus.textContent = localizedText(deleting ? uiFeedback("sidebar.deleting") : "");
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
  translationPositionStatus.textContent = localizedText(
    state.feedback === "saving"
      ? uiFeedback("sidebar.savingTranslationPosition")
      : state.feedback === "saved"
        ? uiFeedback("sidebar.translationPositionSaved")
        : state.feedback === "error"
          ? uiFeedback("sidebar.translationPositionCouldNotBeSavedThe")
          : "",
  );
}

function subtitleStyleInteractionId(field: SidebarSubtitleStyleField): string {
  subtitleStyleInteractionSequence += 1;
  return `style-edit:${field}:${Date.now()}:${subtitleStyleInteractionSequence}`;
}

function rgbaLabel(color: SidebarRgbaColor): string {
  const alpha = Math.round((color.a / 255) * 100);
  if (color.a === 0)
    return localizedText(
      uiFeedback("color.namedAlpha", {
        color: window.subtandemLocalization.colorName("transparent"),
        alpha: 0,
      }),
    );
  if (color.r === 255 && color.g === 255 && color.b === 255)
    return localizedText(
      uiFeedback("color.namedAlpha", {
        color: window.subtandemLocalization.colorName("white"),
        alpha,
      }),
    );
  if (color.r === 0 && color.g === 0 && color.b === 0)
    return localizedText(
      uiFeedback("color.namedAlpha", {
        color: window.subtandemLocalization.colorName("black"),
        alpha,
      }),
    );
  return localizedText(
    uiFeedback("color.rgba", { red: color.r, green: color.g, blue: color.b, alpha }),
  );
}

function rgbaCss(color: SidebarRgbaColor): string {
  return `rgba(${color.r}, ${color.g}, ${color.b}, ${color.a / 255})`;
}

const colorControls: Record<
  SidebarSubtitleColorField,
  { button: HTMLButtonElement; swatch: HTMLElement; label: LocalizedFeedback }
> = {
  fontColor: {
    button: fontColorButton,
    swatch: fontColorSwatch,
    label: uiFeedback("sidebar.fontColor"),
  },
  borderColor: {
    button: borderColorButton,
    swatch: borderColorSwatch,
    label: uiFeedback("sidebar.borderColor"),
  },
  backgroundColor: {
    button: backgroundColorButton,
    swatch: backgroundColorSwatch,
    label: uiFeedback("sidebar.backgroundColor"),
  },
};

function renderColorControl(field: SidebarSubtitleColorField, color: SidebarRgbaColor): void {
  const control = colorControls[field];
  control.swatch.style.setProperty("--subtitle-swatch", rgbaCss(color));
  control.button.setAttribute(
    "aria-label",
    localizedText(
      uiFeedback("color.control", { label: localizedText(control.label), color: rgbaLabel(color) }),
    ),
  );
}

function renderSubtitleStyle(): void {
  const state = sidebarState.snapshot.subtitleStyle;
  const style = state.displayStyle;
  renderColorControl("fontColor", style.fontColor);
  renderColorControl("borderColor", style.borderColor);
  renderColorControl("backgroundColor", style.backgroundColor);
  fontSizeSelect.value = String(style.fontSize);
  borderWidthSelect.value = String(style.borderWidth);
  fontButton.textContent = localizedText(style.fontFamily ?? uiFeedback("sidebar.systemDefault"));
  fontBold.checked = style.bold;
  fontItalic.checked = style.italic;
  fontStatus.textContent = localizedText(
    state.fontResolution.fallbackActive
      ? uiFeedback("font.unavailable", { name: state.fontResolution.preferredFamily ?? "" })
      : "",
  );
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
  subtitleStyleError.textContent = localizedText(state.groupError ?? "");
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

function idleLabelForAction(actionId: string): LocalizedFeedback | null {
  if (actionId === "save-profile") return uiFeedback("sidebar.save");
  if (actionId === "retry-preparation") return uiFeedback("sidebar.retry");
  if (actionId === "test") return uiFeedback("sidebar.test");
  if (actionId === "delete") return uiFeedback("sidebar.delete");
  return null;
}

function setActionBusy(
  actionId: string,
  profileId: string | undefined,
  busy: boolean,
  busyLabel: LocalizedFeedback | null = null,
): void {
  const control = controlForAction(actionId, profileId);
  if (!control) return;
  control.disabled = busy;
  if (busy) control.setAttribute("aria-busy", "true");
  else control.removeAttribute("aria-busy");
  if (actionId === "test") {
    renderDrawerAvailability();
    return;
  }
  if (control instanceof HTMLButtonElement) {
    control.textContent = localizedText(busy ? busyLabel : idleLabelForAction(actionId));
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
      status.textContent = localizedText("");
    }
  }
  const assistiveFeedbackSignature =
    feedback?.visibility === "assistive"
      ? `${feedback.requestId}:${feedback.phase}:${JSON.stringify(feedback.message)}`
      : "";
  if (assistiveFeedbackSignature !== renderedAssistiveFeedbackSignature) {
    operationAnnouncer.textContent = localizedText("");
    renderedAssistiveFeedbackSignature = assistiveFeedbackSignature;
  }
  if (feedback && feedback.visibility === "assistive") {
    if (operationAnnouncer.textContent !== localizedText(feedback.message))
      operationAnnouncer.textContent = localizedText(feedback.message);
  } else if (feedback && feedback.visibility === "visible" && visibleStatus) {
    visibleStatus.dataset.state = feedback.phase;
    if (visibleStatus.textContent !== localizedText(feedback.message))
      visibleStatus.textContent = localizedText(feedback.message);
  }
  updateSubtitleRetryControls();
}

function renderModelFeedback(): void {
  const state = sidebarState.snapshot.modelControl;
  const visibleState = state.validationError ? "error" : state.refreshState;
  if (visibleState === "idle") delete modelCatalogStatus.dataset.state;
  else modelCatalogStatus.dataset.state = visibleState;
  modelCatalogStatus.textContent = localizedText(state.validationError ?? state.refreshMessage);
  refreshModelsButton.setAttribute("aria-busy", String(state.refreshState === "busy"));
}

function setModelRefreshFeedback(
  state: "idle" | "busy" | "success" | "error",
  message: LocalizedFeedback | null = null,
): void {
  sidebarState.setModelRefreshState(state, message);
  renderModelFeedback();
}

function beginOperation(
  regionId: string,
  actionId: string,
  busyLabel: LocalizedFeedback | null,
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
  message: LocalizedFeedback | null,
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
  credentialEditor?.close();
  sidebarState.cancelProfileSave(requestId);
  finishOperation(
    requestId,
    uiFeedback("sidebar.theEditorChangedBeforeThisSaveCompleted"),
    "cancelled",
  );
}

function clearDrawerTestDeadline(): void {
  if (pendingDrawerTestDeadline) clearTimeout(pendingDrawerTestDeadline.timer);
  pendingDrawerTestDeadline = null;
}

function expireDrawerTest(): void {
  const pending = pendingDrawerTestDeadline;
  if (!pending || Date.now() < pending.expiresAtMs) return;
  clearDrawerTestDeadline();
  const current = sidebarState.snapshot.drawer.test;
  if (!current || current.requestId !== pending.requestId || current.phase !== "testing") return;
  const message = window.subtandemProviderTestStatusFeedback({ category: "timeout" });
  if (
    !sidebarState.finishDrawerTest(
      current.requestId,
      false,
      message,
      current.drawerId,
      current.draftRevision,
    )
  )
    return;
  setActionBusy("test", undefined, false);
  profileTestStatus.dataset.state = "error";
  profileTestStatus.textContent = localizedText(message);
  credentialEditor?.close();
  window.iina?.postMessage("provider:test-cancel", envelope({ testRequestId: current.requestId }));
}

function clearDrawerTestFeedback(): void {
  clearDrawerTestDeadline();
  setActionBusy("test", undefined, false);
  delete profileTestStatus.dataset.state;
  profileTestStatus.textContent = localizedText("");
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
    cancelEditorCredentialLoad();
    invalidatePendingModelRefresh();
    clearCredentialInput();
    draftCredentialEpoch += 1;
  }
  if (drawer.mode === "closed") {
    cancelEditorCredentialLoad();
    editingProfile = null;
    clearCredentialInput();
    sidebarState.setProfileContext({ credentialDisplayProfileId: null });
  }
  renderDrawerAvailability();
}

function validModelEndpoint(): boolean {
  try {
    window.subtandemProviderEndpoint.normalizeProviderEndpoint(
      providerKind.value as ProviderKind,
      providerEndpoint.value,
    );
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
  return editingProfile.kind === providerKind.value;
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

function flushAutomaticModelRefresh(): void {
  const intent = sidebarState.snapshot.pendingAutomaticRefresh;
  if (!intent || sidebarState.snapshot.credentialLoad) return;
  if (endpointRefreshTimer !== null) clearTimeout(endpointRefreshTimer);
  endpointRefreshTimer = null;
  if (Date.now() < intent.notBeforeMs) {
    endpointRefreshTimer = setTimeout(flushAutomaticModelRefresh, intent.notBeforeMs - Date.now());
    return;
  }
  sidebarState.snapshot.pendingAutomaticRefresh = null;
  requestModels(intent.trigger);
}

function requestModels(trigger: "open" | "endpoint" | "profile" | "credential" | "manual"): void {
  const drawer = sidebarState.snapshot.drawer;
  if (drawer.mode === "closed") return;
  if (sidebarState.snapshot.credentialLoad) {
    if (trigger !== "manual") sidebarState.queueAutomaticRefresh(trigger);
    return;
  }
  if (trigger !== "manual" && sidebarState.snapshot.pendingAutomaticRefresh) {
    sidebarState.queueAutomaticRefresh(trigger);
    flushAutomaticModelRefresh();
    return;
  }
  if (drawer.savePhase || drawer.deletePhase === "deleting" || drawer.test?.phase === "testing")
    return;
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
  const usesDraftCredential = trigger === "manual";
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
    void sealDrawerOperation(enteredApiKey, "draft-models", requestId)
      .then((operation) => {
        if (pendingModelRefresh?.requestId !== requestId || contextSignature !== modelContextKey())
          return;
        window.iina?.postMessage("provider:draft-models", envelope(operation, requestId));
      })
      .catch(() => {
        if (pendingModelRefresh?.requestId !== requestId) return;
        pendingModelRefresh = null;
        setModelRefreshFeedback("error", uiFeedback("sidebar.modelRefreshFailedTryAgain"));
      });
    return;
  }
  window.iina?.postMessage("provider:models", envelope(modelRefreshPayload(trigger), requestId));
}

function sealDrawerOperation(
  value: string,
  purpose: "draft-test" | "draft-models",
  requestId: string,
  expiresAtMs = Date.now() + 10_000,
) {
  const drawer = sidebarState.snapshot.drawer;
  if (!drawer.drawerId) return Promise.reject(new Error("CREDENTIAL_CHANNEL_UNAVAILABLE"));
  return currentCredentialEditor().sealOperation(
    value,
    {
      kind: providerKind.value as ProviderKind,
      endpoint: window.subtandemProviderEndpoint.normalizeProviderEndpoint(
        providerKind.value as ProviderKind,
        providerEndpoint.value,
      ),
      model: sidebarState.snapshot.modelControl.value.trim() || null,
      proxyMode: providerProxyMode.value === "direct" ? "direct" : "system",
      purpose,
      sourceProfile: drawer.sourceProfile,
      save: null,
    },
    {
      drawerId: drawer.drawerId,
      sourceProfile: drawer.sourceProfile,
      draftRevision: drawer.draftRevision,
      keyEditEpoch: drawer.keyEditEpoch,
      submitEpoch: drawer.submitEpoch,
    },
    requestId,
    expiresAtMs,
  );
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
  sidebarState.queueAutomaticRefresh("endpoint", Date.now() + 400);
  if (!validModelEndpoint()) return;
  endpointRefreshTimer = setTimeout(flushAutomaticModelRefresh, 400);
}

function renderModelControl(): void {
  const state = sidebarState.snapshot.modelControl;
  providerModelSelect.replaceChildren();
  const items = [
    ...state.knownModelIds.map((model) => ({ id: model, requestName: model })),
    { id: "__custom__", requestName: "Custom model ID", messageKey: "sidebar.customModelID" },
  ];
  const modelOptions = window.subtandemLocalization.options("models", JSON.stringify(items), items);
  const customOption = modelOptions.find(({ id }) => id === "__custom__")!;
  const knownOptions = modelOptions.filter(({ id }) => id !== "__custom__");
  for (const model of [customOption, ...knownOptions]) {
    const option = document.createElement("option");
    option.value = model.id;
    option.textContent = model.label;
    providerModelSelect.append(option);
  }
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
  const kind = providerKind.value as ProviderKind;
  const path = window.subtandemProviderEndpoint.providerApiPath(kind, "translation");
  document.querySelector<HTMLElement>("#endpoint-hint")!.textContent = localizedText(
    uiFeedback("endpoint.help", { service: providerLabels[kind], path }),
  );
  let actualRequest = "—";
  try {
    actualRequest = window.subtandemProviderEndpoint.providerApiUrl(
      kind,
      providerEndpoint.value,
      "translation",
    );
  } catch {
    actualRequest = "—";
  }
  requestUrl.textContent = localizedText(uiFeedback("endpoint.request", { url: actualRequest }));
}

function selectedServiceTypeLabel(): string {
  return providerLabels[providerKind.value as ProviderKind];
}

function applyProviderKind(): void {
  const kind = providerKind.value as ProviderKind;
  activeProviderKind = kind;
  providerEndpoint.value = providerDrafts[kind].endpoint;
  providerProxyMode.value = providerDrafts[kind].proxyMode;
  profileName.value = sidebarState.snapshot.profileName.value;
  document.querySelector<HTMLElement>("#credential-row")!.hidden = false;
  document.querySelector<HTMLElement>("#model-hint")!.textContent = localizedText(
    uiFeedback("sidebar.refreshTheCatalogOrEnterTheExact"),
  );
  providerModel.placeholder = localizedText(
    uiFeedback("model.example", { model: modelPlaceholders[kind] }),
  );
  document.querySelector<HTMLElement>("#credential-hint")!.textContent = localizedText(
    uiFeedback("sidebar.enterAnAPIKeyIfTheService"),
  );
  setModelContext(providerDrafts[kind].model);
  updateRequestUrl();
}

providerKind.addEventListener("change", () => {
  cancelEditorCredentialLoad();
  invalidateDrawerTestField();
  cancelPendingProfileSaveForContextChange();
  invalidatePendingModelRefresh();
  saveActiveDraft();
  draftCredentialEpoch += 1;
  clearCredentialInput();
  sidebarState.changeServiceTypeLabel(selectedServiceTypeLabel());
  applyProviderKind();
  renderDrawerAvailability();
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
  renderCredentialVisibility();
  setModelContext(sidebarState.snapshot.modelControl.value);
  setModelRefreshFeedback("idle");
});
profileName.addEventListener("input", () => {
  cancelPendingProfileSaveForContextChange();
  sidebarState.inputProfileName(profileName.value);
});

function resetProviderDrafts(): void {
  Object.assign(providerDrafts, createProviderDrafts());
}

function clearProfileDrawer(focus = true): void {
  if (sidebarState.snapshot.drawer.savePhase) return;
  cancelActiveDrawerTest();
  cancelPendingProfileSaveForContextChange();
  invalidatePendingModelRefresh();
  cancelEditorCredentialLoad();
  const target = sidebarState.closeProfileDrawer();
  editingProfile = null;
  draftCredentialEpoch += 1;
  clearCredentialInput();
  profileTestStatus.textContent = localizedText("");
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
    cancelEditorCredentialLoad();
  }
  const activation = preservePendingSave
    ? { changed: false, closed: false }
    : sidebarState.openProfileDrawer(profile.profileId);
  if (activation.closed) {
    editingProfile = null;
    clearCredentialInput();
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
  credentialEditor?.close();
  resetProviderDrafts();
  editingProfile = profile;
  draftCredentialEpoch += 1;
  clearCredentialInput();
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
  providerKey.placeholder = localizedText(uiFeedback("sidebar.optional"));
  deleteProfileButton.hidden = false;
  saveProfileButton.textContent = localizedText(uiFeedback("sidebar.save"));
  mountProfileDrawer();
  startEditorCredentialLoad();
  requestModels("open");
  if (!preservePendingSave) void readEditorCredential();
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
  cancelEditorCredentialLoad();
  sidebarState.openNewProfileDrawer();
  credentialEditor?.close();
  resetProviderDrafts();
  editingProfile = null;
  draftCredentialEpoch += 1;
  clearCredentialInput();
  providerKind.value = "openai";
  activeProviderKind = "openai";
  sidebarState.setProfileContext({ credentialDisplayProfileId: null });
  sidebarState.resetProfileName("OpenAI");
  profileName.value = sidebarState.snapshot.profileName.value;
  providerKey.placeholder = localizedText(uiFeedback("sidebar.optional"));
  deleteProfileButton.hidden = true;
  saveProfileButton.textContent = localizedText(uiFeedback("sidebar.save"));
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
  clearCredentialInput();
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
    enabled.checked
      ? uiFeedback("sidebar.enablingTranslation")
      : uiFeedback("sidebar.disablingTranslation"),
  );
  window.iina?.postMessage(
    "translation:set-enabled",
    envelope({ enabled: enabled.checked }, requestId),
  );
});

targetLanguage.addEventListener("change", () => {
  if (!targetLanguageHydrated || pendingLanguageSaveRequestId) return;
  if (targetLanguage.value === committedTargetLanguage) return;
  const requestId = beginOperation(
    "language-settings",
    "languages",
    uiFeedback("sidebar.savingLanguages"),
  );
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
  const requestId = beginOperation(
    "subtitle-retry",
    "retry-preparation",
    uiFeedback("sidebar.retrying"),
  );
  window.iina?.postMessage("subtitle:retry-preparation", envelope({}, requestId));
});

testProfileButton.addEventListener("click", () => {
  renderDrawerAvailability();
  if (testProfileButton.disabled) return;
  const drawer = sidebarState.snapshot.drawer;
  if (drawer.mode === "closed" || drawer.validity !== "current") return;
  if (!validModelEndpoint()) {
    profileTestStatus.dataset.state = "error";
    profileTestStatus.textContent = localizedText(uiFeedback("sidebar.enterAValidHTTPSAPIRoot"));
    providerEndpoint.focus();
    return;
  }
  const model = sidebarState.snapshot.modelControl.value.trim();
  if (!model) {
    sidebarState.setModelRequiredError(uiFeedback("sidebar.refreshModelsAndChooseOneOrEnter"));
    renderModelFeedback();
    providerModel.focus();
    return;
  }
  const enteredApiKey = providerKey.value.trim();
  const requestId = nextRequestId();
  const started = sidebarState.beginDrawerTest(requestId);
  if (!started) return;
  clearDrawerTestDeadline();
  const expiresAtMs = Date.now() + drawerTestTimeoutMs;
  pendingDrawerTestDeadline = {
    requestId,
    expiresAtMs,
    timer: setTimeout(expireDrawerTest, drawerTestTimeoutMs),
  };
  profileTestStatus.dataset.state = "busy";
  profileTestStatus.textContent = localizedText(uiFeedback("sidebar.testing"));
  setActionBusy("test", undefined, true);
  void sealDrawerOperation(enteredApiKey, "draft-test", requestId, expiresAtMs)
    .then((operation) => {
      if (
        sidebarState.snapshot.drawer.test?.requestId !== requestId ||
        sidebarState.snapshot.drawer.test.phase !== "testing" ||
        sidebarState.snapshot.drawer.draftRevision !== started.draftRevision
      )
        return;
      window.iina?.postMessage("provider:draft-test", envelope(operation, requestId));
    })
    .catch(() => {
      if (
        sidebarState.snapshot.drawer.test?.requestId !== requestId ||
        sidebarState.snapshot.drawer.test.phase !== "testing"
      )
        return;
      sidebarState.finishDrawerTest(
        requestId,
        false,
        uiFeedback("sidebar.testFailedTryAgain"),
        started.drawerId,
        started.draftRevision,
      );
      clearDrawerTestFeedback();
      profileTestStatus.dataset.state = "error";
      profileTestStatus.textContent = localizedText(uiFeedback("sidebar.testFailedTryAgain"));
    });
});

saveProfileButton.addEventListener("click", async () => {
  renderDrawerAvailability();
  if (saveProfileButton.disabled || sidebarState.snapshot.drawer.mode === "closed") return;
  if (sidebarState.snapshot.drawer.savePhase) return;
  cancelPendingProfileSaveForContextChange();
  const model = sidebarState.modelForSave();
  if (!model) {
    sidebarState.setModelRequiredError(
      uiFeedback("sidebar.refreshModelsAndChooseOneOrEnterACustomModelID"),
    );
    renderModelFeedback();
    providerModel.focus();
    return;
  }
  cancelActiveDrawerTest();
  const requestId = beginOperation(
    "profile-editor",
    "save-profile",
    editingProfile ? uiFeedback("sidebar.updatingProfile") : uiFeedback("sidebar.savingProfile"),
    editingProfile?.profileId,
    editingProfile?.revision,
  );
  pendingProfileSave = {
    requestId,
    contextSignature: editorContextSignature(),
    profileId: editingProfile?.profileId ?? null,
    revision: editingProfile?.revision ?? null,
  };
  sidebarState.beginProfileSave(requestId);
  const value = providerKey.value;
  setProfileSaveLocked(true);
  const drawer = sidebarState.snapshot.drawer;
  const pending = pendingProfileSave;
  try {
    if (!drawer.drawerId) throw new Error("PROFILE_SAVE_FAILED");
    const result = await currentCredentialEditor().save(
      value,
      {
        ...(editingProfile
          ? { profileId: editingProfile.profileId, expectedRevision: editingProfile.revision }
          : {}),
        displayName: profileName.value.trim(),
        kind: providerKind.value as ProviderKind,
        endpoint: providerEndpoint.value.trim(),
        proxyMode: providerProxyMode.value as "system" | "direct",
        model,
      },
      {
        drawerId: drawer.drawerId,
        sourceProfile: drawer.sourceProfile,
        draftRevision: drawer.draftRevision,
        keyEditEpoch: drawer.keyEditEpoch,
        submitEpoch: drawer.submitEpoch,
      },
      requestId,
    );
    if (pendingProfileSave !== pending || pending.contextSignature !== editorContextSignature())
      return;
    sidebarState.completeProfileSave(requestId, null);
    finishOperation(requestId, null);
    pendingProfileSave = null;
    credentialEditor?.close();
    finishSuccessfulProfileSave(result.profile as ProfileView);
    window.iina?.postMessage("ui:ready", envelope({}));
  } catch {
    if (pendingProfileSave !== pending) return;
    sidebarState.completeProfileSave(
      requestId,
      uiFeedback("sidebar.profileCouldNotBeSaved"),
      false,
    );
    finishOperation(requestId, uiFeedback("sidebar.profileCouldNotBeSaved"), "error");
    pendingProfileSave = null;
    credentialEditor?.close();
    setProfileSaveLocked(false);
  }
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
    uiFeedback("sidebar.deleting"),
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

profilesElement.addEventListener("click", (event) => {
  if (event.detail !== 0) return;
  const entry = (event.target as HTMLElement).closest<HTMLElement>(".profile-details");
  const profile = entry ? profiles.get(entry.dataset.profileId ?? "") : null;
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

onBusinessMessage("profile-activation:state", (raw: unknown) => {
  if (!sidebarState.applyProfileAuthority(raw as SidebarProfileAuthority)) return;
  clearConfirmedProfileActivationTimeouts();
  renderedProfilesSignature = "";
  renderProfiles(sidebarState.snapshot.profiles as unknown as ProfileView[]);
});

onBusinessMessage("profile-activation:result", (raw: unknown) => {
  const value = raw as SidebarProfileActivationResult;
  const timeout = profileActivationTimeouts.get(value.requestId);
  if (timeout !== undefined) {
    window.clearTimeout(timeout);
    profileActivationTimeouts.delete(value.requestId);
  }
  const result = sidebarState.finishProfileActivation(value);
  if (!result.accepted && !result.authorityAccepted) return;
  clearConfirmedProfileActivationTimeouts();
  renderedProfilesSignature = "";
  renderProfiles(sidebarState.snapshot.profiles as unknown as ProfileView[]);
});

onBusinessMessage("profile:deleted", (raw: unknown) => {
  const result = raw as { requestId?: string; profileId?: string };
  if (typeof result.requestId !== "string" || typeof result.profileId !== "string") return;
  const pendingDelete =
    pendingOperations.has(result.requestId) &&
    sidebarState.snapshot.requests[result.requestId]?.actionId === "delete" &&
    sidebarState.snapshot.requests[result.requestId]?.profileId === result.profileId;
  sidebarState.deleteSucceeded({
    requestId: result.requestId,
    profileId: result.profileId,
    message: uiFeedback("sidebar.profileAndSavedCredentialDeleted"),
  });
  if (editingProfile?.profileId === result.profileId) resetEditor();
  if (pendingDelete) setActionBusy("delete", result.profileId, false);
  pendingOperations.delete(result.requestId);
  renderedProfilesSignature = "";
  renderProfiles(sidebarState.snapshot.profiles as unknown as ProfileView[]);
  window.iina?.postMessage("ui:ready", envelope({}));
});

onBusinessMessage("provider:test-result", (raw: unknown) => {
  expireDrawerTest();
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
    currentTest.phase !== "testing" ||
    currentTest.requestId !== result.requestId ||
    currentTest.drawerId !== result.drawerId ||
    currentTest.draftRevision !== result.draftRevision
  )
    return;
  const message = window.subtandemProviderTestStatusFeedback({
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
  clearDrawerTestDeadline();
  if (result.code === "TEST_INVALIDATED") credentialEditor?.close();
  setActionBusy("test", undefined, false);
  profileTestStatus.dataset.state =
    result.ok === true ? "success" : result.code === "TEST_INVALIDATED" ? "pending" : "error";
  profileTestStatus.textContent = localizedText(message);
});

onBusinessMessage("provider:models-result", (raw: unknown) => {
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
      setModelRefreshFeedback("error", uiFeedback("sidebar.theModelListResponseWasIncompatible"));
      return;
    }
    const value = sidebarState.snapshot.modelControl.value;
    sidebarState.setModelContext(stateContextKey, value);
    sidebarState.applyModelCatalog(stateContextKey, result.models as string[]);
    renderModelControl();
    setModelRefreshFeedback(
      "success",
      window.subtandemModelCatalogStatusFeedback({
        ok: true,
        count: sidebarState.snapshot.modelControl.knownModelIds.length,
      }),
    );
    return;
  }
  const message = window.subtandemModelCatalogStatusFeedback({
    ok: false,
    ...(typeof result.category === "string" ? { category: result.category } : {}),
    ...(typeof result.statusCode === "number" ? { statusCode: result.statusCode } : {}),
    credentialSource,
  });
  setModelRefreshFeedback("error", message);
});

onBusinessMessage("operation:result", (raw: unknown) => {
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
        ? uiFeedback("sidebar.targetLanguageWasNotChanged")
        : succeeded
          ? uiFeedback("sidebar.targetLanguageSaved")
          : uiFeedback("sidebar.targetLanguageCouldNotBeSavedThe"),
      result.cancelled ? "cancelled" : succeeded ? "success" : "error",
      result.cancelled ? "visible" : undefined,
    );
    return;
  }
  const message = result.cancelled
    ? uiFeedback("sidebar.operationCancelledNothingWasChanged")
    : result.action === "translation"
      ? enabled.checked
        ? uiFeedback("sidebar.translationEnabled")
        : uiFeedback("sidebar.translationDisabled")
      : result.action === "retry-preparation"
        ? result.ok === true
          ? uiFeedback("sidebar.subtitlePreparationRestarted")
          : uiFeedback("sidebar.retryIsNoLongerAvailableForThis")
        : uiFeedback("sidebar.operationCompleted");
  finishOperation(
    result.requestId,
    message,
    result.cancelled ? "cancelled" : result.ok === true ? "success" : "error",
  );
});

onBusinessMessage("operation:error", (raw: unknown) => {
  const result = raw as { requestId?: string };
  const languageSaveAccepted = finishLanguageSave(result.requestId);
  if (languageSaveAccepted) {
    finishOperation(
      result.requestId,
      uiFeedback("sidebar.targetLanguageCouldNotBeSavedThe"),
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
      ? uiFeedback("sidebar.theProfileCouldNotBeDeletedReview")
      : uiFeedback("sidebar.theOperationCouldNotBeCompletedReview"),
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

const profileOverflow = new Map<
  HTMLElement,
  { observer: ResizeObserver; description: HTMLElement }
>();

document.fonts?.addEventListener("loadingdone", () => {
  for (const article of profileRows.values()) syncProfileOverflow(article);
});

function profileDisplayLines(article: HTMLElement): HTMLElement[] {
  return [
    article.querySelector<HTMLElement>("strong")!,
    article.querySelector<HTMLElement>(".profile-summary")!,
    article.querySelector<HTMLElement>("code")!,
  ];
}

function syncProfileOverflow(article: HTMLElement): void {
  const state = profileOverflow.get(article);
  if (!state) return;
  const disclosure = article.querySelector<HTMLElement>(".profile-disclosure")!;
  const descriptions = profileDisplayLines(article).flatMap((line, index) => {
    if (line.scrollWidth <= line.clientWidth) {
      line.removeAttribute("title");
      return [];
    }
    const fullText = line.textContent ?? "";
    line.setAttribute("title", localizedText(fullText));
    return [
      localizedText(
        uiFeedback("profile.details", {
          label: localizedText(
            [
              uiFeedback("sidebar.name"),
              uiFeedback("sidebar.serviceAndModel"),
              uiFeedback("sidebar.apiRoot"),
            ][index],
          ),
          value: fullText,
        }),
      ),
    ];
  });
  state.description.textContent = localizedText(descriptions.join("; "));
  if (descriptions.length) disclosure.setAttribute("aria-describedby", state.description.id);
  else disclosure.removeAttribute("aria-describedby");
}

function clearProfileOverflow(article: HTMLElement): void {
  const state = profileOverflow.get(article);
  if (!state) return;
  state.observer.disconnect();
  state.description.textContent = localizedText("");
  article.querySelector<HTMLElement>(".profile-disclosure")!.removeAttribute("aria-describedby");
  for (const line of profileDisplayLines(article)) line.removeAttribute("title");
  profileOverflow.delete(article);
}

function createProfileRow(profile: ProfileView): HTMLElement {
  const article = document.createElement("article");
  article.className = "profile";
  article.innerHTML = `<div class="profile-heading"><div class="profile-details profile-disclosure"><span class="disclosure-indicator" aria-hidden="true"></span><span class="profile-copy"><strong dir="auto"></strong><span class="profile-summary" dir="ltr"></span><code dir="ltr"></code></span></div><label class="switch profile-activation"><input type="checkbox"></label></div><p class="operation-status profile-operation-status" role="status" aria-live="polite"></p>`;
  const disclosure = article.querySelector<HTMLElement>(".profile-disclosure")!;
  disclosure.className = "profile-disclosure profile-details";
  disclosure.tabIndex = 0;
  disclosure.setAttribute("role", "button");
  const activation = article.querySelector<HTMLInputElement>(".profile-activation input")!;
  activation.role = "switch";
  activation.dataset.action = "activation";
  updateProfileRow(article, profile);
  const description = document.createElement("span");
  description.className = "assistive-only profile-overflow-description";
  description.id = `profile-summary-description-${profile.profileId}`;
  disclosure.append(description);
  const observer = new ResizeObserver(() => syncProfileOverflow(article));
  for (const line of profileDisplayLines(article)) observer.observe(line);
  observer.observe(disclosure);
  profileOverflow.set(article, { observer, description });
  return article;
}

function updateProfileRow(article: HTMLElement, profile: ProfileView): void {
  const panelId = `profile-drawer-${profile.profileId}`;
  article.dataset.profileId = profile.profileId;
  const disclosure = article.querySelector<HTMLElement>(".profile-disclosure")!;
  disclosure.dataset.profileId = profile.profileId;
  disclosure.setAttribute(
    "aria-label",
    localizedText(uiFeedback("profile.edit", { name: profile.displayName })),
  );
  disclosure.setAttribute("aria-expanded", "false");
  disclosure.setAttribute("aria-controls", panelId);
  article.querySelector("strong")!.textContent = localizedText(profile.displayName);
  article.querySelector<HTMLElement>(".profile-summary")!.textContent = localizedText(
    `${providerLabels[profile.kind]}${profile.model ? ` · ${profile.model}` : ""}`,
  );
  article.querySelector("code")!.textContent = localizedText(profile.endpoint);
  const activation = article.querySelector<HTMLInputElement>(".profile-activation input")!;
  activation.dataset.profileId = profile.profileId;
  activation.setAttribute(
    "aria-label",
    localizedText(uiFeedback("profile.enable", { name: profile.displayName })),
  );
  const status = article.querySelector<HTMLParagraphElement>(".profile-operation-status")!;
  status.dataset.profileId = profile.profileId;
  syncProfileOverflow(article);
}

function createNewProfileRow(): HTMLElement {
  const article = document.createElement("article");
  article.className = "profile profile-new is-editing";
  article.dataset.newProfile = "true";
  article.innerHTML = `<div class="profile-heading"><div class="profile-details profile-disclosure"><span class="disclosure-indicator" aria-hidden="true"></span><span class="profile-copy"><strong></strong></span></div></div>`;
  article.querySelector("strong")!.textContent = localizedText(uiFeedback("sidebar.newProfile"));
  const disclosure = article.querySelector<HTMLElement>(".profile-disclosure")!;
  disclosure.tabIndex = 0;
  disclosure.setAttribute("role", "button");
  disclosure.setAttribute("aria-label", localizedText(uiFeedback("sidebar.closeNewProfile")));
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

function syncDrawerRuntimeTick(active: boolean): void {
  if (!active) {
    if (drawerRuntimeTick !== null) window.clearInterval(drawerRuntimeTick);
    drawerRuntimeTick = null;
  } else if (drawerRuntimeTick === null) {
    drawerRuntimeTick = window.setInterval(() => window.iina?.postMessage("runtime:tick", {}), 20);
  }
}

function mountProfileDrawer(): void {
  const drawer = sidebarState.snapshot.drawer;
  syncDrawerRuntimeTick(drawer.mode !== "closed");
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
  if (profileDrawer.parentElement !== article) article.append(profileDrawer);
  renderDrawerAvailability();
}

function renderDrawerAvailability(): void {
  const drawer = sidebarState.snapshot.drawer;
  const conflict = drawer.validity === "conflict";
  const saving = drawer.savePhase !== null;
  const deleting = drawer.deletePhase === "deleting";
  const testing = drawer.test?.phase === "testing";
  const loading = sidebarState.snapshot.credentialLoad !== null;
  testProfileButton.disabled = loading || conflict || saving || deleting || testing;
  saveProfileButton.disabled = loading || conflict || saving || deleting;
  deleteProfileButton.disabled = conflict || saving || deleting;
  cancelProfileButton.disabled = saving || deleting;
  refreshModelsButton.disabled = loading || conflict || saving || deleting || testing;
  newProfileButton.disabled = saving;
  if (conflict) {
    profileEditorStatus.dataset.conflict = "true";
    profileEditorStatus.dataset.state = "error";
    profileEditorStatus.textContent = localizedText(
      uiFeedback("sidebar.thisProfileChangedInAnotherWindowCancel"),
    );
    return;
  }
  if (profileEditorStatus.dataset.conflict === "true") {
    delete profileEditorStatus.dataset.conflict;
    delete profileEditorStatus.dataset.state;
    profileEditorStatus.textContent = localizedText("");
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
    const profile = profiles.get(profileId);
    input.setAttribute(
      "aria-label",
      localizedText(
        profile ? uiFeedback("profile.enable", { name: profile.displayName }) : view.accessibleName,
      ),
    );
    input.setAttribute("aria-checked", String(view.checked));
    if (view.busy) input.setAttribute("aria-busy", "true");
    else input.removeAttribute("aria-busy");
    const status = profilesElement.querySelector<HTMLParagraphElement>(
      `.profile-operation-status[data-profile-id="${profileId}"]`,
    );
    if (status && (view.error || view.readinessMessage)) {
      status.textContent = localizedText(view.error ?? view.readinessMessage ?? "");
      status.dataset.state = view.error ? "error" : "pending";
    } else if (status) {
      status.textContent = localizedText("");
      delete status.dataset.state;
    }
  }
}

function renderProfiles(viewProfiles: ProfileView[]): void {
  const nextIds = new Set(viewProfiles.map((profile) => profile.profileId));
  for (const [profileId, article] of profileRows) {
    if (nextIds.has(profileId)) continue;
    clearProfileOverflow(article);
    article.remove();
    profileRows.delete(profileId);
  }
  profiles.clear();
  const drawer = sidebarState.snapshot.drawer;
  if (drawer.mode === "new") {
    newProfileRow ??= createNewProfileRow();
    if (newProfileRow.parentElement !== profilesElement) profilesElement.append(newProfileRow);
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
    syncProfileOverflow(article);
  }
  const settled = sidebarState.snapshot.profileListPhase === "settled";
  const emptyList = settled && !viewProfiles.length && drawer.mode !== "new";
  profilesElement.dataset.empty = String(emptyList);
  const existingEmpty = profilesElement.querySelector<HTMLElement>(":scope > .empty");
  if (emptyList) {
    const empty = existingEmpty ?? document.createElement("p");
    empty.className = "empty";
    empty.textContent = localizedText(uiFeedback("sidebar.noProfilesYet"));
    profilesElement.append(empty);
  } else existingEmpty?.remove();
  renderActiveFeedback();
  mountProfileDrawer();
  renderProfileActivationControls();
  renderDeleteDialog();
}

onBusinessMessage("subtitle-style:state", (raw: unknown) => {
  if (sidebarState.applySubtitleStyleState(raw as SidebarSubtitleStyleAuthorityState))
    renderSubtitleStyle();
});

onBusinessMessage("subtitle-style:save-result", (raw: unknown) => {
  if (sidebarState.finishSubtitleStyleSave(raw as SidebarSubtitleStyleSaveResult))
    renderSubtitleStyle();
});

onBusinessMessage("subtitle-style:picker-result", (raw: unknown) => {
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
    if (result.outcome === "unchanged") subtitleStyleError.textContent = localizedText("");
    return;
  }
  if (result.requestId !== pendingFontPickerRequestId || !result.authority) return;
  pendingFontPickerRequestId = null;
  fontButton.setAttribute("aria-busy", "false");
  sidebarState.applySubtitleStyleState(result.authority);
  renderSubtitleStyle();
  if (result.outcome === "failed") {
    subtitleStyleError.textContent = localizedText(
      uiFeedback("sidebar.theSubtitleFontPickerIsUnavailable"),
    );
    subtitleStyleError.dataset.state = "error";
  }
});

function reorderNamedOptions(): void {
  const selectedKind = providerKind.value || "openai";
  const services = Array.from(providerKind.options);
  const serviceItems = services.map((option) => ({
    id: option.value,
    requestName: option.textContent ?? "",
  }));
  for (const option of window.subtandemLocalization.options(
    "services",
    JSON.stringify(serviceItems),
    serviceItems,
  )) {
    const element = services.find((service) => service.value === option.id)!;
    element.textContent = option.label;
    providerKind.append(element);
  }
  providerKind.value = selectedKind;
  const favorites = colorPalette.querySelector<HTMLElement>(".subtitle-color-favorites")!;
  const colors = Array.from(favorites.querySelectorAll<HTMLButtonElement>("button[data-color-id]"));
  const colorItems = colors.map((button) => ({
    id: button.dataset.colorId!,
    requestName: button.getAttribute("aria-label") ?? "",
  }));
  for (const option of window.subtandemLocalization.options("colors", 1, colorItems)) {
    const element = colors.find((color) => color.dataset.colorId === option.id)!;
    element.setAttribute("aria-label", option.label);
    favorites.append(element);
  }
  renderModelControl();
}

function renderStaticLocalization(): void {
  for (const element of Array.from(document.querySelectorAll<HTMLElement>("[data-i18n]")))
    element.textContent = localizedText(uiFeedback(element.dataset.i18n!));
  for (const attribute of ["aria-label", "title", "placeholder"] as const) {
    const dataAttribute = `data-i18n-${attribute}`;
    for (const element of Array.from(
      document.querySelectorAll<HTMLElement>(`[${dataAttribute}]`),
    )) {
      const value = localizedText(uiFeedback(element.getAttribute(dataAttribute)!));
      element.setAttribute(attribute, value);
      if (attribute === "placeholder" && element instanceof HTMLInputElement)
        element.placeholder = value;
    }
  }
  for (const button of Array.from(
    colorPalette.querySelectorAll<HTMLButtonElement>("button[data-color-id]"),
  ))
    button.setAttribute(
      "aria-label",
      window.subtandemLocalization.colorName(button.dataset.colorId!),
    );
  subtitleColorGrid.replaceChildren();
  populateSubtitleColorGrid();
  reorderNamedOptions();
  renderCredentialVisibility();
  applyProviderKindLocalization();
}

function applyProviderKindLocalization(): void {
  const kind = providerKind.value as ProviderKind;
  providerModel.placeholder = localizedText(
    uiFeedback("model.example", { model: modelPlaceholders[kind] }),
  );
  updateRequestUrl();
}

window.iina?.onMessage("state:update", (raw: unknown) => {
  const snapshot = window.subtandemLocalization.parseSnapshot(raw);
  if (!snapshot) return;
  if (retiredUiAuthorities.has(snapshot.uiLanguage.authorityId)) return;
  if (renderedUiAuthority && snapshot.uiLanguage.authorityId !== renderedUiAuthority) {
    const authority = snapshot.profileAuthority as SidebarProfileAuthority | undefined;
    if (!authority || authority.authorityId !== snapshot.uiLanguage.authorityId) return;
    retiredUiAuthorities.add(renderedUiAuthority);
    window.subtandemLocalization.clearDirectories();
    uiSnapshotReady = false;
    pendingSidebarEvents.splice(0);
    cancelPendingProfileSaveForContextChange();
    sidebarState.snapshot.drawer.savePhase = null;
    resetEditor();
    closeDeleteDialog(false);
    pendingOperations.clear();
    for (const timeout of profileActivationTimeouts.values()) window.clearTimeout(timeout);
    profileActivationTimeouts.clear();
    pendingFontPickerRequestId = null;
    pendingColorPickerRequestId = null;
    profiles.clear();
    Object.assign(sidebarState.snapshot, window.createSubTandemSidebarState().snapshot);
    renderedProfilesSignature = "";
    renderedLanguageCatalogSignature = "";
    lastSessionPresentationSignature = "";
  }
  const languageChanged =
    renderedUiAuthority === null ||
    window.subtandemLocalization.locale !== snapshot.uiLanguage.locale;
  renderedUiAuthority = snapshot.uiLanguage.authorityId;
  window.subtandemLocalization.setLocale(snapshot.uiLanguage.locale);
  document.documentElement.lang = snapshot.uiLanguage.locale;
  document.documentElement.dir = snapshot.uiLanguage.direction;
  if (languageChanged) {
    renderStaticLocalization();
    lastSessionPresentationSignature = "";
    renderedProfilesSignature = "";
  }
  const view = snapshot as {
    status?: SessionStatus;
    source?: {
      format: string;
      cueCount: number;
    } | null;
    cacheSize?: number;
    profiles?: ProfileView[];
    profileAuthority?: SidebarProfileAuthority;
    profileListPhase?: "initializing" | "settled";
    sourceIssue?: string | null;
    providerError?: SessionProviderError | null;
    sourcePreparation?: {
      state: SourcePreparationState;
      canRetry: boolean;
      canReselect: boolean;
    } | null;
    targetLanguage?: string;
    targetLanguageRevision?: number;
    targetLanguages?: Array<{ id: string; requestName: string }>;
    overlayPosition?: SidebarOverlayPositionAuthorityState;
    subtitleStyle?: SidebarSubtitleStyleAuthorityState | null;
  };
  if (view.profileListPhase === "settled") sidebarState.settleProfileList();
  if (view.overlayPosition && sidebarState.applyOverlayPositionState(view.overlayPosition))
    renderOverlayPosition();
  if (view.subtitleStyle && sidebarState.applySubtitleStyleState(view.subtitleStyle))
    renderSubtitleStyle();
  if (view.profileAuthority) {
    const previousTest = sidebarState.snapshot.drawer.test;
    sidebarState.applyProfileAuthority(view.profileAuthority);
    clearConfirmedProfileActivationTimeouts();
    reconcileDrawerAfterAuthority(previousTest);
  }
  if (view.targetLanguages) {
    const signature = JSON.stringify([window.subtandemLocalization.locale, view.targetLanguages]);
    if (signature !== renderedLanguageCatalogSignature) {
      const displayedTargetLanguage = targetLanguage.value;
      renderedLanguageCatalogSignature = signature;
      targetLanguage.replaceChildren();
      for (const language of window.subtandemLocalization.options(
        "targets",
        signature,
        view.targetLanguages,
      )) {
        const option = document.createElement("option");
        option.value = language.id;
        option.textContent = language.label;
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
    statusMessage.textContent = localizedText(sessionPresentation.message);
    statusDot.dataset.state = sessionPresentation.state;
  }
  if (view.status) enabled.checked = view.status !== "disabled";
  const sourceDetails = window.subtandemResolveSessionSourceDetails(view);
  subtitleDetailsVisible = sourceDetails.detailsVisible;
  subtitleRetryAvailable = sourceDetails.retryAvailable;
  if (!subtitleDetailsVisible) {
    for (const requestId of sidebarState.clearOperationRegion("subtitle-retry"))
      pendingOperations.delete(requestId);
    subtitleRetryStatus.textContent = localizedText("");
    sourcePreparationControls.hidden = true;
    retrySubtitleButton.hidden = true;
    sourceSummary.hidden = true;
  } else {
    updateSubtitleRetryControls();
  }
  if (sourceDetails.source && subtitleDetailsVisible) {
    sourceSummary.hidden = false;
    document.querySelector<HTMLElement>("#source-format")!.textContent = localizedText(
      window.subtandemSubtitleFormatLabel(sourceDetails.source.format),
    );
    document.querySelector<HTMLElement>("#cache-size")!.textContent = localizedText(
      Number.isSafeInteger(view.cacheSize) && (view.cacheSize ?? -1) >= 0
        ? window.subtandemLocalization.number(view.cacheSize!)
        : "—",
    );
    document.querySelector<HTMLElement>("#source-cues")!.textContent = localizedText(
      Number.isSafeInteger(sourceDetails.source.cueCount) && sourceDetails.source.cueCount >= 0
        ? window.subtandemLocalization.number(sourceDetails.source.cueCount)
        : "—",
    );
  } else {
    sourceSummary.hidden = true;
    document.querySelector<HTMLElement>("#source-format")!.textContent = localizedText("");
    document.querySelector<HTMLElement>("#cache-size")!.textContent = localizedText("");
    document.querySelector<HTMLElement>("#source-cues")!.textContent = localizedText("");
  }
  if (view.profiles) {
    const previousTest = sidebarState.snapshot.drawer.test;
    const visibleProfiles = sidebarState.applyProfiles(
      view.profiles as unknown as SidebarStateProfile[],
    ) as unknown as ProfileView[];
    reconcileDrawerAfterAuthority(previousTest);
    const signature = JSON.stringify({
      profileListPhase: sidebarState.snapshot.profileListPhase,
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
  renderSubtitleStyle();
  renderOverlayPosition();
  renderModelFeedback();
  renderActiveFeedback();
  appElement.removeAttribute("inert");
  appElement.removeAttribute("aria-busy");
  uiSnapshotReady = true;
  for (const apply of pendingSidebarEvents.splice(0)) apply();
});

window.iina?.postMessage("ui:ready", envelope({}));
window.setInterval(() => {
  expireDrawerTest();
  window.iina?.postMessage("ui:poll", envelope({}));
}, 750);
window.addEventListener("pagehide", () => {
  syncDrawerRuntimeTick(false);
  cancelEditorCredentialLoad();
  for (const article of profileRows.values()) clearProfileOverflow(article);
  if (endpointRefreshTimer !== null) clearTimeout(endpointRefreshTimer);
  invalidatePendingModelRefresh();
  const requestId = sidebarState.cancelDrawerTest();
  if (!requestId) return;
  window.iina?.postMessage("provider:test-cancel", envelope({ testRequestId: requestId }));
});
window.addEventListener("pageshow", () => {
  syncDrawerRuntimeTick(sidebarState.snapshot.drawer.mode !== "closed");
});
renderSubtitleStyle();
applyProviderKind();
