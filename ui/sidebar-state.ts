type SidebarFeedbackPhase = "busy" | "success" | "error" | "cancelled";
type SidebarFeedbackVisibility = "assistive" | "visible";

interface SidebarStateProfile {
  profileId: string;
  revision: number;
  [key: string]: unknown;
}

interface SidebarActivationReference {
  profileId: string;
  profileRevision: number;
  kind: string;
  endpointFingerprint: string;
  credentialConfigured: boolean;
}

interface SidebarProfileAuthority {
  authorityId: string;
  stateVersion: number;
  ready: boolean;
  activationGeneration: number;
  activation: SidebarActivationReference | null;
  profiles: SidebarStateProfile[];
}

interface SidebarProfileActivationResult {
  requestId: string;
  outcome: "changed" | "unchanged" | "failed" | "pending";
  authority: SidebarProfileAuthority;
  error?: { code: string; userAction: string };
}

interface SidebarOperationRequest {
  requestId: string;
  regionId: string;
  actionId: string;
  profileId?: string;
  revision?: number;
  busyMessage?: string;
}

interface SidebarRegionRequest {
  requestId: string;
  actionId: string;
}

interface SidebarFeedback {
  requestId: string;
  regionId: string;
  actionId: string;
  phase: SidebarFeedbackPhase;
  message: string;
  visibility: "assistive" | "visible";
}

interface ProfileNameState {
  value: string;
  mode: "system" | "user" | "saved";
  serviceTypeLabel: string;
}

interface PendingProfileSaveState {
  requestId: string;
  profileId: string | null;
  revision: number | null;
  credentialPending: boolean;
  selectionInvalidated: boolean;
}

interface SidebarDeleteConfirmationState {
  profileId: string;
  expectedRevision: number;
  displayName: string;
  phase: "confirming" | "deleting";
  requestId: string | null;
}

interface ModelControlState {
  value: string;
  mode: "known" | "custom";
  knownModelIds: string[];
  contextKey: string;
  refreshState: "idle" | "busy" | "success" | "error";
  refreshMessage: string;
  validationError: string | null;
}

interface SidebarOverlayPositionState {
  displayPosition: number;
  committedPosition: number;
  intentSequence: number;
  committedRevision: number;
  interaction: "idle" | "previewing";
  pendingSaveRequestId: string | null;
  feedback: "idle" | "saving" | "saved" | "error";
}

interface SidebarOverlayPositionAuthorityState {
  phase: "snapshot" | "preview" | "committed" | "reverted";
  position: number;
  committedPosition: number;
  intentSequence: number;
  committedRevision: number;
}

type SidebarOverlayPositionSaveResult =
  | {
      requestId: string;
      ok: true;
      position: number;
      intentSequence: number;
      committedRevision: number;
    }
  | {
      requestId: string;
      ok: false;
      committedPosition: number;
      intentSequence: number;
      committedRevision: number;
    };

type SidebarSubtitleStyleField =
  | "fontColor"
  | "fontSize"
  | "fontFamily"
  | "bold"
  | "italic"
  | "borderColor"
  | "borderWidth"
  | "backgroundColor";

type SidebarSubtitleColorField = "fontColor" | "borderColor" | "backgroundColor";

interface SidebarRgbaColor {
  r: number;
  g: number;
  b: number;
  a: number;
}

interface SidebarSubtitleTextStyle {
  fontColor: SidebarRgbaColor;
  fontSize: number;
  fontFamily: string | null;
  bold: boolean;
  italic: boolean;
  borderColor: SidebarRgbaColor;
  borderWidth: number;
  backgroundColor: SidebarRgbaColor;
}

interface SidebarFontResolution {
  preferredFamily: string | null;
  availability: "available" | "unavailable" | "unknown";
  effectiveFamily: string | null;
  fallbackActive: boolean;
  catalogRevision: number;
}

interface SidebarSubtitleStyleAuthorityState {
  phase: "snapshot" | "preview" | "committed" | "reverted" | "availability";
  liveStyle: SidebarSubtitleTextStyle;
  committedStyle: SidebarSubtitleTextStyle;
  changedField: SidebarSubtitleStyleField | null;
  stateRevision: number;
  latestIntentSequence: number;
  committedRevision: number;
  fontResolution: SidebarFontResolution;
}

interface SidebarSubtitleStyleState {
  displayStyle: SidebarSubtitleTextStyle;
  committedStyle: SidebarSubtitleTextStyle;
  stateRevision: number;
  committedRevision: number;
  interactionByField: Record<SidebarSubtitleStyleField, string | null>;
  pendingByField: Record<
    SidebarSubtitleStyleField,
    { requestId: string; interactionId: string } | null
  >;
  feedbackByField: Record<SidebarSubtitleStyleField, "idle" | "saving" | "saved">;
  groupError: string | null;
  fontResolution: SidebarFontResolution;
  colorTarget: "fontColor" | "borderColor" | "backgroundColor" | null;
  nativeColorSession: {
    requestId: string;
    field: SidebarSubtitleColorField;
  } | null;
}

type SidebarSubtitleStyleSaveResult =
  | {
      requestId: string;
      field: SidebarSubtitleStyleField;
      ok: true;
      outcome: "committed" | "superseded";
      intentSequence: number;
      authority: SidebarSubtitleStyleAuthorityState;
    }
  | {
      requestId: string;
      field: SidebarSubtitleStyleField;
      ok: false;
      code: "SUBTITLE_STYLE_SAVE_FAILED";
      userAction: "EDIT_AGAIN";
      intentSequence: number;
      authority: SidebarSubtitleStyleAuthorityState;
    };

interface SidebarStateSnapshot {
  profiles: SidebarStateProfile[];
  deletedProfileIds: string[];
  editingProfileId: string | null;
  profileEditorContextVersion: number;
  selectedProfileId: string | null;
  profileAuthority: SidebarProfileAuthority | null;
  profileActivationRequests: Record<
    string,
    { requestId: string; profileId: string; enabled: boolean }
  >;
  profileActivationErrors: Record<string, string>;
  credentialDisplayProfileId: string | null;
  profileTests: Record<string, unknown>;
  requests: Record<string, SidebarOperationRequest>;
  latestRequestByRegion: Record<string, SidebarRegionRequest>;
  activeFeedback: SidebarFeedback | null;
  profileName: ProfileNameState;
  pendingProfileSave: PendingProfileSaveState | null;
  deleteConfirmation: SidebarDeleteConfirmationState | null;
  modelControl: ModelControlState;
  overlayPosition: SidebarOverlayPositionState;
  subtitleStyle: SidebarSubtitleStyleState;
}

interface SidebarStateCoordinator {
  readonly snapshot: SidebarStateSnapshot;
  applyProfiles(profiles: SidebarStateProfile[]): SidebarStateProfile[];
  reconcileEditingProfile(profile: SidebarStateProfile): SidebarStateProfile;
  setProfileContext(context: {
    editingProfileId?: string | null;
    selectedProfileId?: string | null;
    credentialDisplayProfileId?: string | null;
  }): void;
  setProfileTest(profileId: string, value: unknown): void;
  activateProfileEditor(profileId: string): {
    changed: boolean;
    discardedProfileId: string | null;
  };
  openDeleteConfirmation(target: {
    profileId: string;
    expectedRevision: number;
    displayName: string;
  }): boolean;
  cancelDeleteConfirmation(): SidebarDeleteConfirmationState | null;
  beginProfileDelete(requestId: string): {
    profileId: string;
    expectedRevision: number;
    displayName: string;
  } | null;
  finishProfileDeleteFailure(requestId: string): boolean;
  applyProfileAuthority(authority: SidebarProfileAuthority): boolean;
  profileActivationView(profileId: string): {
    checked: boolean;
    disabled: boolean;
    busy: boolean;
    accessibleName: string;
    error: string | null;
    readinessMessage: string | null;
  };
  beginProfileActivation(requestId: string, profileId: string, enabled: boolean): boolean;
  finishProfileActivation(result: SidebarProfileActivationResult): {
    accepted: boolean;
    authorityAccepted: boolean;
    announce: boolean;
  };
  beginOperation(request: SidebarOperationRequest, message?: string): void;
  finishOperation(
    requestId: string,
    phase: SidebarFeedbackPhase,
    message: string,
    visibility?: SidebarFeedbackVisibility,
  ): { accepted: boolean; request?: SidebarOperationRequest };
  deleteSucceeded(input: { requestId: string; profileId: string; message: string }): {
    announced: boolean;
  };
  resetProfileName(serviceTypeLabel: string): void;
  changeServiceTypeLabel(serviceTypeLabel: string): void;
  inputProfileName(value: string): void;
  loadProfileName(value: string, serviceTypeLabel: string): void;
  beginProfileSave(requestId: string, credentialPending: boolean): void;
  profileRevisionCreated(
    requestId: string,
    result: { profileId: string; revision: number; selectionInvalidated: boolean },
  ): { accepted: boolean; waitingForCredential: boolean };
  completeProfileSave(
    requestId: string,
    fallbackMessage: string,
    succeeded?: boolean,
  ): string | null;
  cancelProfileSave(requestId: string): void;
  setModelContext(contextKey: string, value: string): void;
  applyModelCatalog(contextKey: string, models: string[]): boolean;
  setModelRefreshState(state: ModelControlState["refreshState"], message?: string): void;
  setModelRequiredError(message: string): void;
  clearModelRequiredError(): boolean;
  modelForSave(): string | null;
  selectKnownModel(value: string): void;
  selectCustomModel(): void;
  inputCustomModelValue(value: string): void;
  previewOverlayPosition(position: number): boolean;
  beginOverlayPositionSave(requestId: string): boolean;
  completeOverlayPositionInteraction(requestId: string): boolean;
  applyOverlayPositionState(state: SidebarOverlayPositionAuthorityState): boolean;
  finishOverlayPositionSave(result: SidebarOverlayPositionSaveResult): boolean;
  previewSubtitleStyle(
    interactionId: string,
    field: SidebarSubtitleStyleField,
    value: unknown,
  ): boolean;
  beginSubtitleStyleSave(
    requestId: string,
    interactionId: string,
    field: SidebarSubtitleStyleField,
  ): boolean;
  applySubtitleStyleState(state: SidebarSubtitleStyleAuthorityState): boolean;
  finishSubtitleStyleSave(result: SidebarSubtitleStyleSaveResult): boolean;
  openSubtitleColorPalette(field: SidebarSubtitleColorField): boolean;
  closeSubtitleColorPalette(): void;
  beginSubtitleColorPicker(requestId: string, field: SidebarSubtitleColorField): boolean;
  restartSubtitleColorPicker(requestId: string, field: SidebarSubtitleColorField): boolean;
  finishSubtitleColorPicker(
    requestId: string,
    outcome: "confirmed" | "cancelled" | "unchanged" | "focused" | "failed",
    authority: SidebarSubtitleStyleAuthorityState,
  ): boolean;
}

interface Window {
  createSubTandemSidebarState(profiles?: SidebarStateProfile[]): SidebarStateCoordinator;
  bindSubTandemModelControls(options: SidebarModelControlBindings): void;
}

interface SidebarModelControlElement {
  value: string;
  addEventListener(type: string, listener: () => void): void;
  focus(): void;
}

interface SidebarModelControlBindings {
  state: SidebarStateCoordinator;
  modelSelect: SidebarModelControlElement;
  customModelInput: SidebarModelControlElement;
  cancelPendingSave(): void;
  renderModelControl(): void;
  renderModelFeedback(): void;
}

function createSubTandemSidebarState(
  initialProfiles: SidebarStateProfile[] = [],
): SidebarStateCoordinator {
  const defaultSubtitleStyle: SidebarSubtitleTextStyle = {
    fontColor: { r: 255, g: 255, b: 255, a: 255 },
    fontSize: 40,
    fontFamily: null,
    bold: false,
    italic: false,
    borderColor: { r: 0, g: 0, b: 0, a: 255 },
    borderWidth: 3,
    backgroundColor: { r: 0, g: 0, b: 0, a: 0 },
  };
  const subtitleStyleFields: SidebarSubtitleStyleField[] = [
    "fontColor",
    "fontSize",
    "fontFamily",
    "bold",
    "italic",
    "borderColor",
    "borderWidth",
    "backgroundColor",
  ];
  const fieldRecord = <T>(value: T): Record<SidebarSubtitleStyleField, T> =>
    Object.fromEntries(subtitleStyleFields.map((field) => [field, value])) as Record<
      SidebarSubtitleStyleField,
      T
    >;
  const cloneStyle = (style: SidebarSubtitleTextStyle): SidebarSubtitleTextStyle => ({
    ...style,
    fontColor: { ...style.fontColor },
    borderColor: { ...style.borderColor },
    backgroundColor: { ...style.backgroundColor },
  });
  const snapshot: SidebarStateSnapshot = {
    profiles: [...initialProfiles],
    deletedProfileIds: [],
    editingProfileId: null,
    profileEditorContextVersion: 0,
    selectedProfileId: null,
    profileAuthority: null,
    profileActivationRequests: {},
    profileActivationErrors: {},
    credentialDisplayProfileId: null,
    profileTests: {},
    requests: {},
    latestRequestByRegion: {},
    activeFeedback: null,
    profileName: {
      value: "OpenAI",
      mode: "system",
      serviceTypeLabel: "OpenAI",
    },
    pendingProfileSave: null,
    deleteConfirmation: null,
    modelControl: {
      value: "",
      mode: "custom",
      knownModelIds: [],
      contextKey: "",
      refreshState: "idle",
      refreshMessage: "",
      validationError: null,
    },
    overlayPosition: {
      displayPosition: 0,
      committedPosition: 0,
      intentSequence: 0,
      committedRevision: 0,
      interaction: "idle",
      pendingSaveRequestId: null,
      feedback: "idle",
    },
    subtitleStyle: {
      displayStyle: cloneStyle(defaultSubtitleStyle),
      committedStyle: cloneStyle(defaultSubtitleStyle),
      stateRevision: -1,
      committedRevision: 0,
      interactionByField: fieldRecord<string | null>(null),
      pendingByField: fieldRecord<{ requestId: string; interactionId: string } | null>(null),
      feedbackByField: fieldRecord<"idle" | "saving" | "saved">("idle"),
      groupError: null,
      fontResolution: {
        preferredFamily: null,
        availability: "available",
        effectiveFamily: null,
        fallbackActive: false,
        catalogRevision: 0,
      },
      colorTarget: null,
      nativeColorSession: null,
    },
  };
  const writeFeedback = (
    request: SidebarOperationRequest,
    phase: SidebarFeedbackPhase,
    message: string,
    visibility: SidebarFeedbackVisibility = phase === "error" ? "visible" : "assistive",
  ): void => {
    snapshot.activeFeedback = {
      requestId: request.requestId,
      regionId: request.regionId,
      actionId: request.actionId,
      phase,
      message,
      visibility,
    };
  };

  const applyProfiles = (profiles: SidebarStateProfile[]): SidebarStateProfile[] => {
    const deleted = new Set(snapshot.deletedProfileIds);
    snapshot.profiles = profiles.filter((profile) => !deleted.has(profile.profileId));
    const confirmation = snapshot.deleteConfirmation;
    if (
      confirmation &&
      !snapshot.profiles.some(
        (profile) =>
          profile.profileId === confirmation.profileId &&
          profile.revision === confirmation.expectedRevision,
      )
    )
      snapshot.deleteConfirmation = null;
    return snapshot.profiles;
  };

  const reconcileEditingProfile = (profile: SidebarStateProfile): SidebarStateProfile => {
    const latest = snapshot.profiles.find((candidate) => candidate.profileId === profile.profileId);
    if (!latest || (snapshot.pendingProfileSave && latest.revision !== profile.revision))
      return profile;
    return latest;
  };

  const setProfileContext = (context: {
    editingProfileId?: string | null;
    selectedProfileId?: string | null;
    credentialDisplayProfileId?: string | null;
  }): void => {
    if ("editingProfileId" in context) snapshot.editingProfileId = context.editingProfileId ?? null;
    if ("selectedProfileId" in context)
      snapshot.selectedProfileId = context.selectedProfileId ?? null;
    if ("credentialDisplayProfileId" in context)
      snapshot.credentialDisplayProfileId = context.credentialDisplayProfileId ?? null;
  };

  const setProfileTest = (profileId: string, value: unknown): void => {
    snapshot.profileTests[profileId] = value;
  };

  const openDeleteConfirmation = (target: {
    profileId: string;
    expectedRevision: number;
    displayName: string;
  }): boolean => {
    if (snapshot.deleteConfirmation) return false;
    const profile = snapshot.profiles.find(
      (candidate) =>
        candidate.profileId === target.profileId && candidate.revision === target.expectedRevision,
    );
    if (!profile || !target.displayName.trim()) return false;
    snapshot.deleteConfirmation = {
      ...target,
      displayName: target.displayName.trim(),
      phase: "confirming",
      requestId: null,
    };
    return true;
  };

  const cancelDeleteConfirmation = (): SidebarDeleteConfirmationState | null => {
    const confirmation = snapshot.deleteConfirmation;
    if (!confirmation || confirmation.phase !== "confirming") return null;
    snapshot.deleteConfirmation = null;
    return confirmation;
  };

  const beginProfileDelete = (
    requestId: string,
  ): { profileId: string; expectedRevision: number; displayName: string } | null => {
    const confirmation = snapshot.deleteConfirmation;
    if (!confirmation || confirmation.phase !== "confirming" || !requestId) return null;
    const profile = snapshot.profiles.find(
      (candidate) =>
        candidate.profileId === confirmation.profileId &&
        candidate.revision === confirmation.expectedRevision,
    );
    if (!profile) {
      snapshot.deleteConfirmation = null;
      return null;
    }
    confirmation.phase = "deleting";
    confirmation.requestId = requestId;
    return {
      profileId: confirmation.profileId,
      expectedRevision: confirmation.expectedRevision,
      displayName: confirmation.displayName,
    };
  };

  const finishProfileDeleteFailure = (requestId: string): boolean => {
    const confirmation = snapshot.deleteConfirmation;
    if (!confirmation || confirmation.phase !== "deleting" || confirmation.requestId !== requestId)
      return false;
    snapshot.deleteConfirmation = null;
    return true;
  };

  const cloneProfileAuthority = (authority: SidebarProfileAuthority): SidebarProfileAuthority => ({
    ...authority,
    activation: authority.activation ? { ...authority.activation } : null,
    profiles: authority.profiles.map((profile) => ({ ...profile })),
  });

  const applyProfileAuthority = (authority: SidebarProfileAuthority): boolean => {
    const current = snapshot.profileAuthority;
    if (current) {
      if (
        authority.authorityId !== current.authorityId ||
        authority.stateVersion < current.stateVersion
      )
        return false;
      if (authority.stateVersion === current.stateVersion)
        return JSON.stringify(authority) === JSON.stringify(current);
    }
    snapshot.profileAuthority = cloneProfileAuthority(authority);
    applyProfiles(authority.profiles);
    return true;
  };

  const profileActivationView = (profileId: string) => {
    const authority = snapshot.profileAuthority;
    const profile = authority?.profiles.find((candidate) => candidate.profileId === profileId);
    const pending = Object.values(snapshot.profileActivationRequests).find(
      (request) => request.profileId === profileId,
    );
    return {
      checked: Boolean(
        authority?.activation?.profileId === profileId &&
        authority.activation.profileRevision === profile?.revision,
      ),
      disabled: !authority?.ready || Object.keys(snapshot.profileActivationRequests).length > 0,
      busy: Boolean(pending),
      accessibleName: `Enable ${String(profile?.displayName ?? "Profile")}`,
      error: snapshot.profileActivationErrors[profileId] ?? null,
      readinessMessage: authority?.ready
        ? null
        : "Profile activation is restoring or waiting for storage confirmation.",
    };
  };

  const beginProfileActivation = (
    requestId: string,
    profileId: string,
    enabled: boolean,
  ): boolean => {
    const authority = snapshot.profileAuthority;
    if (
      !requestId ||
      !authority?.ready ||
      Object.keys(snapshot.profileActivationRequests).length > 0 ||
      !authority.profiles.some((profile) => profile.profileId === profileId)
    )
      return false;
    snapshot.profileActivationRequests[requestId] = { requestId, profileId, enabled };
    delete snapshot.profileActivationErrors[profileId];
    return true;
  };

  const finishProfileActivation = (result: SidebarProfileActivationResult) => {
    const request = snapshot.profileActivationRequests[result.requestId];
    if (!request) return { accepted: false, authorityAccepted: false, announce: false };
    delete snapshot.profileActivationRequests[result.requestId];
    const authorityAccepted = applyProfileAuthority(result.authority);
    if (result.outcome === "failed")
      snapshot.profileActivationErrors[request.profileId] =
        "Profile activation could not be changed. Try again.";
    return {
      accepted: true,
      authorityAccepted,
      announce: result.outcome === "changed" || result.outcome === "failed",
    };
  };

  const beginOperation = (request: SidebarOperationRequest, message = ""): void => {
    const pendingRequest = { ...request, busyMessage: message };
    snapshot.requests[request.requestId] = pendingRequest;
    snapshot.latestRequestByRegion[request.regionId] = {
      requestId: request.requestId,
      actionId: request.actionId,
    };
    writeFeedback(pendingRequest, "busy", message);
  };

  const finishOperation = (
    requestId: string,
    phase: SidebarFeedbackPhase,
    message: string,
    visibility?: SidebarFeedbackVisibility,
  ): { accepted: boolean; request?: SidebarOperationRequest } => {
    const request = snapshot.requests[requestId];
    if (!request) return { accepted: false };
    delete snapshot.requests[requestId];
    const current = snapshot.latestRequestByRegion[request.regionId];
    if (current?.requestId !== requestId) return { accepted: false, request };
    writeFeedback(request, phase, message, visibility);
    return { accepted: true, request };
  };

  const deleteSucceeded = (input: {
    requestId: string;
    profileId: string;
    message: string;
  }): { announced: boolean } => {
    const request = snapshot.requests[input.requestId];
    const localDelete =
      request?.actionId === "delete" &&
      request.profileId === input.profileId &&
      snapshot.latestRequestByRegion[request.regionId]?.requestId === input.requestId;
    const isNewDeletion = !snapshot.deletedProfileIds.includes(input.profileId);
    if (isNewDeletion) snapshot.deletedProfileIds.push(input.profileId);
    snapshot.profiles = snapshot.profiles.filter(
      (profile) => profile.profileId !== input.profileId,
    );
    if (snapshot.editingProfileId === input.profileId) snapshot.editingProfileId = null;
    if (snapshot.selectedProfileId === input.profileId) snapshot.selectedProfileId = null;
    if (snapshot.credentialDisplayProfileId === input.profileId)
      snapshot.credentialDisplayProfileId = null;
    if (snapshot.deleteConfirmation?.profileId === input.profileId)
      snapshot.deleteConfirmation = null;
    delete snapshot.profileTests[input.profileId];
    for (const [requestId, pending] of Object.entries(snapshot.requests)) {
      if (pending.profileId === input.profileId) delete snapshot.requests[requestId];
    }
    for (const regionId of Object.keys(snapshot.latestRequestByRegion)) {
      if (regionId === `profile-row:${input.profileId}`)
        delete snapshot.latestRequestByRegion[regionId];
    }
    if (localDelete && request) {
      writeFeedback(request, "success", input.message, "assistive");
      return { announced: true };
    }
    return { announced: false };
  };

  const resetProfileName = (serviceTypeLabel: string): void => {
    snapshot.profileName = {
      value: serviceTypeLabel,
      mode: "system",
      serviceTypeLabel,
    };
  };

  const changeServiceTypeLabel = (serviceTypeLabel: string): void => {
    snapshot.profileName = {
      value: snapshot.profileName.mode === "system" ? serviceTypeLabel : snapshot.profileName.value,
      mode: snapshot.profileName.mode,
      serviceTypeLabel,
    };
  };

  const inputProfileName = (value: string): void => {
    snapshot.profileName = {
      value,
      mode: "user",
      serviceTypeLabel: snapshot.profileName.serviceTypeLabel,
    };
  };

  const loadProfileName = (value: string, serviceTypeLabel: string): void => {
    snapshot.profileName = { value, mode: "saved", serviceTypeLabel };
  };

  const beginProfileSave = (requestId: string, credentialPending: boolean): void => {
    snapshot.pendingProfileSave = {
      requestId,
      profileId: null,
      revision: null,
      credentialPending,
      selectionInvalidated: false,
    };
  };

  const profileRevisionCreated = (
    requestId: string,
    result: { profileId: string; revision: number; selectionInvalidated: boolean },
  ): { accepted: boolean; waitingForCredential: boolean } => {
    const pending = snapshot.pendingProfileSave;
    if (!pending || pending.requestId !== requestId)
      return { accepted: false, waitingForCredential: false };
    snapshot.pendingProfileSave = {
      ...pending,
      profileId: result.profileId,
      revision: result.revision,
      selectionInvalidated: pending.selectionInvalidated || result.selectionInvalidated,
    };
    return { accepted: true, waitingForCredential: pending.credentialPending };
  };

  const completeProfileSave = (
    requestId: string,
    fallbackMessage: string,
    succeeded = true,
  ): string | null => {
    const pending = snapshot.pendingProfileSave;
    if (!pending || pending.requestId !== requestId) return null;
    snapshot.pendingProfileSave = null;
    return succeeded && pending.selectionInvalidated
      ? "Profile updated. Enable it when you are ready."
      : fallbackMessage;
  };

  const cancelProfileSave = (requestId: string): void => {
    if (snapshot.pendingProfileSave?.requestId === requestId) snapshot.pendingProfileSave = null;
  };

  const classifyModelValue = (): void => {
    snapshot.modelControl.mode = snapshot.modelControl.knownModelIds.includes(
      snapshot.modelControl.value,
    )
      ? "known"
      : "custom";
  };

  const modelCatalogs = new Map<string, string[]>();
  const customModelContexts = new Set<string>();

  const activateProfileEditor = (profileId: string) => {
    if (
      snapshot.editingProfileId === profileId ||
      !snapshot.profiles.some((profile) => profile.profileId === profileId)
    )
      return { changed: false, discardedProfileId: null };
    const discardedProfileId = snapshot.editingProfileId;
    snapshot.editingProfileId = profileId;
    snapshot.profileEditorContextVersion += 1;
    snapshot.pendingProfileSave = null;
    snapshot.modelControl = {
      value: "",
      mode: "custom",
      knownModelIds: [],
      contextKey: "",
      refreshState: "idle",
      refreshMessage: "",
      validationError: null,
    };
    modelCatalogs.clear();
    customModelContexts.clear();
    return { changed: true, discardedProfileId };
  };

  const setModelContext = (contextKey: string, value: string): void => {
    if (snapshot.modelControl.contextKey !== contextKey) {
      snapshot.modelControl.contextKey = contextKey;
      snapshot.modelControl.knownModelIds = [...(modelCatalogs.get(contextKey) ?? [])];
      snapshot.modelControl.refreshState = "idle";
      snapshot.modelControl.refreshMessage = "";
      snapshot.modelControl.validationError = null;
    }
    snapshot.modelControl.value = value;
    if (customModelContexts.has(contextKey)) snapshot.modelControl.mode = "custom";
    else classifyModelValue();
  };

  const applyModelCatalog = (contextKey: string, models: string[]): boolean => {
    if (snapshot.modelControl.contextKey !== contextKey) return false;
    const seen = new Set<string>();
    snapshot.modelControl.knownModelIds = models.filter((model) => {
      if (!model || seen.has(model)) return false;
      seen.add(model);
      return true;
    });
    modelCatalogs.set(contextKey, [...snapshot.modelControl.knownModelIds]);
    snapshot.modelControl.refreshState = "success";
    if (customModelContexts.has(contextKey)) snapshot.modelControl.mode = "custom";
    else classifyModelValue();
    return true;
  };

  const selectKnownModel = (value: string): void => {
    customModelContexts.delete(snapshot.modelControl.contextKey);
    snapshot.modelControl.value = value;
    classifyModelValue();
  };

  const selectCustomModel = (): void => {
    customModelContexts.add(snapshot.modelControl.contextKey);
    snapshot.modelControl.mode = "custom";
  };

  const inputCustomModelValue = (value: string): void => {
    customModelContexts.add(snapshot.modelControl.contextKey);
    snapshot.modelControl.value = value;
    snapshot.modelControl.mode = "custom";
  };

  const setModelRefreshState = (state: ModelControlState["refreshState"], message = ""): void => {
    snapshot.modelControl.refreshState = state;
    snapshot.modelControl.refreshMessage = message;
  };

  const setModelRequiredError = (message: string): void => {
    snapshot.modelControl.validationError = message;
  };

  const clearModelRequiredError = (): boolean => {
    if (!snapshot.modelControl.validationError || !snapshot.modelControl.value.trim()) return false;
    snapshot.modelControl.validationError = null;
    return true;
  };

  const modelForSave = (): string | null => snapshot.modelControl.value.trim() || null;

  const validOverlayPosition = (value: unknown): value is number =>
    Number.isInteger(value) && (value as number) >= 0 && (value as number) <= 100;

  const previewOverlayPosition = (position: number): boolean => {
    if (!validOverlayPosition(position)) return false;
    snapshot.overlayPosition.displayPosition = position;
    snapshot.overlayPosition.interaction = "previewing";
    snapshot.overlayPosition.feedback = "idle";
    return true;
  };

  const beginOverlayPositionSave = (requestId: string): boolean => {
    if (!requestId || snapshot.overlayPosition.pendingSaveRequestId === requestId) return false;
    snapshot.overlayPosition.pendingSaveRequestId = requestId;
    snapshot.overlayPosition.interaction = "idle";
    snapshot.overlayPosition.feedback = "saving";
    return true;
  };

  const completeOverlayPositionInteraction = (requestId: string): boolean => {
    if (snapshot.overlayPosition.interaction !== "previewing") return false;
    return beginOverlayPositionSave(requestId);
  };

  const applyOverlayPositionState = (state: SidebarOverlayPositionAuthorityState): boolean => {
    if (
      state.phase === "snapshot" &&
      state.intentSequence === snapshot.overlayPosition.intentSequence &&
      (snapshot.overlayPosition.interaction === "previewing" ||
        snapshot.overlayPosition.pendingSaveRequestId !== null)
    )
      return false;
    if (
      !validOverlayPosition(state.position) ||
      !validOverlayPosition(state.committedPosition) ||
      !Number.isInteger(state.intentSequence) ||
      state.intentSequence < snapshot.overlayPosition.intentSequence ||
      !Number.isInteger(state.committedRevision) ||
      state.committedRevision < 0
    )
      return false;
    snapshot.overlayPosition.displayPosition = state.position;
    snapshot.overlayPosition.committedPosition = state.committedPosition;
    snapshot.overlayPosition.intentSequence = state.intentSequence;
    snapshot.overlayPosition.committedRevision = state.committedRevision;
    if (state.phase === "committed" || state.phase === "reverted") {
      snapshot.overlayPosition.interaction = "idle";
    }
    return true;
  };

  const finishOverlayPositionSave = (result: SidebarOverlayPositionSaveResult): boolean => {
    if (
      snapshot.overlayPosition.pendingSaveRequestId !== result.requestId ||
      result.intentSequence < snapshot.overlayPosition.intentSequence ||
      !Number.isInteger(result.committedRevision) ||
      result.committedRevision < 0
    )
      return false;
    if (result.ok) {
      if (!validOverlayPosition(result.position)) return false;
      snapshot.overlayPosition.displayPosition = result.position;
      snapshot.overlayPosition.committedPosition = result.position;
      snapshot.overlayPosition.feedback = "saved";
    } else {
      if (!validOverlayPosition(result.committedPosition)) return false;
      snapshot.overlayPosition.displayPosition = result.committedPosition;
      snapshot.overlayPosition.committedPosition = result.committedPosition;
      snapshot.overlayPosition.feedback = "error";
    }
    snapshot.overlayPosition.intentSequence = result.intentSequence;
    snapshot.overlayPosition.committedRevision = result.committedRevision;
    snapshot.overlayPosition.pendingSaveRequestId = null;
    snapshot.overlayPosition.interaction = "idle";
    return true;
  };

  const validRgba = (value: unknown): value is SidebarRgbaColor => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return false;
    const color = value as Record<string, unknown>;
    return (
      Object.keys(color).sort().join(",") === "a,b,g,r" &&
      [color.r, color.g, color.b, color.a].every(
        (channel) =>
          Number.isInteger(channel) && (channel as number) >= 0 && (channel as number) <= 255,
      )
    );
  };

  const printableFontFamily = (value: string): boolean =>
    Array.from(value).every((character) => {
      const code = character.charCodeAt(0);
      return code > 31 && code !== 127;
    });

  const validSubtitleStyleValue = (field: SidebarSubtitleStyleField, value: unknown): boolean => {
    if (field === "fontColor" || field === "borderColor" || field === "backgroundColor")
      return validRgba(value);
    if (field === "fontSize") return [30, 35, 40, 45, 50, 55, 60, 65, 70].includes(value as number);
    if (field === "borderWidth")
      return [0, 0.25, 0.5, 1, 1.5, 2, 2.5, 3, 4, 5].includes(value as number);
    if (field === "fontFamily")
      return (
        value === null ||
        (typeof value === "string" &&
          value.length >= 1 &&
          value.length <= 256 &&
          printableFontFamily(value))
      );
    return typeof value === "boolean";
  };

  const validSubtitleStyle = (value: unknown): value is SidebarSubtitleTextStyle => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return false;
    const style = value as Record<string, unknown>;
    return (
      Object.keys(style).sort().join(",") === [...subtitleStyleFields].sort().join(",") &&
      subtitleStyleFields.every((field) => validSubtitleStyleValue(field, style[field]))
    );
  };

  const validFontResolution = (value: unknown): value is SidebarFontResolution => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return false;
    const resolution = value as Record<string, unknown>;
    if (
      Object.keys(resolution).sort().join(",") !==
        "availability,catalogRevision,effectiveFamily,fallbackActive,preferredFamily" ||
      !validSubtitleStyleValue("fontFamily", resolution.preferredFamily) ||
      !validSubtitleStyleValue("fontFamily", resolution.effectiveFamily) ||
      !["available", "unavailable", "unknown"].includes(String(resolution.availability)) ||
      typeof resolution.fallbackActive !== "boolean" ||
      !Number.isInteger(resolution.catalogRevision) ||
      (resolution.catalogRevision as number) < 0
    )
      return false;
    const preferred = resolution.preferredFamily as string | null;
    const expectedEffective =
      preferred !== null && resolution.availability === "available" ? preferred : null;
    return (
      resolution.effectiveFamily === expectedEffective &&
      resolution.fallbackActive ===
        (preferred !== null && resolution.availability === "unavailable")
    );
  };

  const validAuthorityState = (state: SidebarSubtitleStyleAuthorityState): boolean =>
    Boolean(
      state &&
      ["snapshot", "preview", "committed", "reverted", "availability"].includes(state.phase) &&
      validSubtitleStyle(state.liveStyle) &&
      validSubtitleStyle(state.committedStyle) &&
      (state.changedField === null || subtitleStyleFields.includes(state.changedField)) &&
      Number.isInteger(state.stateRevision) &&
      state.stateRevision >= 0 &&
      Number.isInteger(state.latestIntentSequence) &&
      state.latestIntentSequence >= 0 &&
      Number.isInteger(state.committedRevision) &&
      state.committedRevision >= 0 &&
      validFontResolution(state.fontResolution),
    );

  const previewSubtitleStyle = (
    interactionId: string,
    field: SidebarSubtitleStyleField,
    value: unknown,
  ): boolean => {
    if (
      !interactionId ||
      !subtitleStyleFields.includes(field) ||
      !validSubtitleStyleValue(field, value)
    )
      return false;
    snapshot.subtitleStyle.displayStyle = {
      ...cloneStyle(snapshot.subtitleStyle.displayStyle),
      [field]:
        field === "fontColor" || field === "borderColor" || field === "backgroundColor"
          ? { ...(value as SidebarRgbaColor) }
          : value,
    };
    snapshot.subtitleStyle.interactionByField[field] = interactionId;
    snapshot.subtitleStyle.feedbackByField[field] = "idle";
    snapshot.subtitleStyle.groupError = null;
    return true;
  };

  const beginSubtitleStyleSave = (
    requestId: string,
    interactionId: string,
    field: SidebarSubtitleStyleField,
  ): boolean => {
    if (
      !requestId ||
      !interactionId ||
      snapshot.subtitleStyle.interactionByField[field] !== interactionId
    )
      return false;
    snapshot.subtitleStyle.pendingByField[field] = { requestId, interactionId };
    snapshot.subtitleStyle.feedbackByField[field] = "saving";
    return true;
  };

  const applySubtitleStyleState = (state: SidebarSubtitleStyleAuthorityState): boolean => {
    if (!validAuthorityState(state)) return false;
    if (state.stateRevision < snapshot.subtitleStyle.stateRevision) return false;
    if (state.stateRevision === snapshot.subtitleStyle.stateRevision) {
      return (
        JSON.stringify({
          liveStyle: snapshot.subtitleStyle.displayStyle,
          committedStyle: snapshot.subtitleStyle.committedStyle,
          committedRevision: snapshot.subtitleStyle.committedRevision,
          fontResolution: snapshot.subtitleStyle.fontResolution,
        }) ===
        JSON.stringify({
          liveStyle: state.liveStyle,
          committedStyle: state.committedStyle,
          committedRevision: state.committedRevision,
          fontResolution: state.fontResolution,
        })
      );
    }
    snapshot.subtitleStyle.displayStyle = cloneStyle(state.liveStyle);
    snapshot.subtitleStyle.committedStyle = cloneStyle(state.committedStyle);
    snapshot.subtitleStyle.stateRevision = state.stateRevision;
    snapshot.subtitleStyle.committedRevision = state.committedRevision;
    snapshot.subtitleStyle.fontResolution = { ...state.fontResolution };
    if (state.phase === "reverted") {
      snapshot.subtitleStyle.interactionByField = fieldRecord<string | null>(null);
      snapshot.subtitleStyle.pendingByField = fieldRecord<{
        requestId: string;
        interactionId: string;
      } | null>(null);
      snapshot.subtitleStyle.feedbackByField = fieldRecord<"idle" | "saving" | "saved">("idle");
    }
    return true;
  };

  const finishSubtitleStyleSave = (result: SidebarSubtitleStyleSaveResult): boolean => {
    const pending = snapshot.subtitleStyle.pendingByField[result.field];
    if (
      !pending ||
      pending.requestId !== result.requestId ||
      !validAuthorityState(result.authority)
    )
      return false;
    if (!result.ok) {
      applySubtitleStyleState(result.authority);
      snapshot.subtitleStyle.displayStyle = cloneStyle(result.authority.committedStyle);
      snapshot.subtitleStyle.committedStyle = cloneStyle(result.authority.committedStyle);
      snapshot.subtitleStyle.interactionByField = fieldRecord<string | null>(null);
      snapshot.subtitleStyle.pendingByField = fieldRecord<{
        requestId: string;
        interactionId: string;
      } | null>(null);
      snapshot.subtitleStyle.feedbackByField = fieldRecord<"idle" | "saving" | "saved">("idle");
      snapshot.subtitleStyle.groupError =
        "Subtitle style could not be saved. The previous style remains active.";
      snapshot.subtitleStyle.colorTarget = null;
      snapshot.subtitleStyle.nativeColorSession = null;
      return true;
    }
    applySubtitleStyleState(result.authority);
    if (snapshot.subtitleStyle.pendingByField[result.field]?.requestId !== result.requestId)
      return true;
    snapshot.subtitleStyle.pendingByField[result.field] = null;
    snapshot.subtitleStyle.interactionByField[result.field] = null;
    snapshot.subtitleStyle.feedbackByField[result.field] =
      result.outcome === "committed" ? "saved" : "idle";
    return true;
  };

  const openSubtitleColorPalette = (field: SidebarSubtitleColorField): boolean => {
    if (!["fontColor", "borderColor", "backgroundColor"].includes(field)) return false;
    snapshot.subtitleStyle.colorTarget = field;
    return true;
  };

  const closeSubtitleColorPalette = (): void => {
    snapshot.subtitleStyle.colorTarget = null;
  };

  const beginSubtitleColorPicker = (
    requestId: string,
    field: SidebarSubtitleColorField,
  ): boolean => {
    if (
      !/^[A-Za-z0-9_.:-]{1,128}$/.test(requestId) ||
      !["fontColor", "borderColor", "backgroundColor"].includes(field) ||
      snapshot.subtitleStyle.nativeColorSession
    )
      return false;
    snapshot.subtitleStyle.nativeColorSession = { requestId, field };
    snapshot.subtitleStyle.feedbackByField[field] = "saving";
    snapshot.subtitleStyle.groupError = null;
    return true;
  };

  const restartSubtitleColorPicker = (
    requestId: string,
    field: SidebarSubtitleColorField,
  ): boolean => {
    if (
      !/^[A-Za-z0-9_.:-]{1,128}$/.test(requestId) ||
      !["fontColor", "borderColor", "backgroundColor"].includes(field)
    )
      return false;
    const session = snapshot.subtitleStyle.nativeColorSession;
    if (session)
      snapshot.subtitleStyle.feedbackByField[session.field] = snapshot.subtitleStyle.pendingByField[
        session.field
      ]
        ? "saving"
        : "idle";
    snapshot.subtitleStyle.nativeColorSession = null;
    return beginSubtitleColorPicker(requestId, field);
  };

  const finishSubtitleColorPicker = (
    requestId: string,
    outcome: "confirmed" | "cancelled" | "unchanged" | "focused" | "failed",
    authority: SidebarSubtitleStyleAuthorityState,
  ): boolean => {
    const session = snapshot.subtitleStyle.nativeColorSession;
    if (!session || session.requestId !== requestId || !validAuthorityState(authority))
      return false;
    if (
      authority.stateRevision >= snapshot.subtitleStyle.stateRevision &&
      !applySubtitleStyleState(authority)
    )
      return false;
    snapshot.subtitleStyle.nativeColorSession = null;
    snapshot.subtitleStyle.feedbackByField[session.field] = "idle";
    if (outcome === "failed")
      snapshot.subtitleStyle.groupError =
        "The system color picker is unavailable. The previous style remains active.";
    return true;
  };

  return {
    snapshot,
    applyProfiles,
    reconcileEditingProfile,
    setProfileContext,
    setProfileTest,
    activateProfileEditor,
    openDeleteConfirmation,
    cancelDeleteConfirmation,
    beginProfileDelete,
    finishProfileDeleteFailure,
    applyProfileAuthority,
    profileActivationView,
    beginProfileActivation,
    finishProfileActivation,
    beginOperation,
    finishOperation,
    deleteSucceeded,
    resetProfileName,
    changeServiceTypeLabel,
    inputProfileName,
    loadProfileName,
    beginProfileSave,
    profileRevisionCreated,
    completeProfileSave,
    cancelProfileSave,
    setModelContext,
    applyModelCatalog,
    setModelRefreshState,
    setModelRequiredError,
    clearModelRequiredError,
    modelForSave,
    selectKnownModel,
    selectCustomModel,
    inputCustomModelValue,
    previewOverlayPosition,
    beginOverlayPositionSave,
    completeOverlayPositionInteraction,
    applyOverlayPositionState,
    finishOverlayPositionSave,
    previewSubtitleStyle,
    beginSubtitleStyleSave,
    applySubtitleStyleState,
    finishSubtitleStyleSave,
    openSubtitleColorPalette,
    closeSubtitleColorPalette,
    beginSubtitleColorPicker,
    restartSubtitleColorPicker,
    finishSubtitleColorPicker,
  };
}

function bindSubTandemModelControls(options: SidebarModelControlBindings): void {
  options.modelSelect.addEventListener("change", () => {
    options.cancelPendingSave();
    const customSelected = options.modelSelect.value === "__custom__";
    if (customSelected) options.state.selectCustomModel();
    else options.state.selectKnownModel(options.modelSelect.value);
    options.renderModelControl();
    if (options.state.clearModelRequiredError()) options.renderModelFeedback();
    if (customSelected) options.customModelInput.focus();
  });
  options.customModelInput.addEventListener("input", () => {
    options.cancelPendingSave();
    options.state.inputCustomModelValue(options.customModelInput.value);
    if (options.state.clearModelRequiredError()) options.renderModelFeedback();
  });
}

(globalThis as typeof globalThis & Window).createSubTandemSidebarState =
  createSubTandemSidebarState;
(globalThis as typeof globalThis & Window).bindSubTandemModelControls = bindSubTandemModelControls;
