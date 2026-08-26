type SidebarFeedbackPhase = "busy" | "success" | "error" | "cancelled";
type SidebarFeedbackVisibility = "assistive" | "visible";

interface SidebarStateProfile {
  profileId: string;
  revision: number;
  [key: string]: unknown;
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

interface ModelControlState {
  value: string;
  mode: "known" | "custom";
  knownModelIds: string[];
  contextKey: string;
  refreshState: "idle" | "busy" | "success" | "error";
  refreshMessage: string;
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

interface SidebarStateSnapshot {
  profiles: SidebarStateProfile[];
  deletedProfileIds: string[];
  editingProfileId: string | null;
  selectedProfileId: string | null;
  credentialDisplayProfileId: string | null;
  profileTests: Record<string, unknown>;
  requests: Record<string, SidebarOperationRequest>;
  latestRequestByRegion: Record<string, SidebarRegionRequest>;
  activeFeedback: SidebarFeedback | null;
  profileName: ProfileNameState;
  pendingProfileSave: PendingProfileSaveState | null;
  modelControl: ModelControlState;
  overlayPosition: SidebarOverlayPositionState;
}

interface SidebarStateCoordinator {
  readonly snapshot: SidebarStateSnapshot;
  applyProfiles(profiles: SidebarStateProfile[]): SidebarStateProfile[];
  setProfileContext(context: {
    editingProfileId?: string | null;
    selectedProfileId?: string | null;
    credentialDisplayProfileId?: string | null;
  }): void;
  setProfileTest(profileId: string, value: unknown): void;
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
  selectKnownModel(value: string): void;
  selectCustomModel(): void;
  inputCustomModelValue(value: string): void;
  previewOverlayPosition(position: number): boolean;
  beginOverlayPositionSave(requestId: string): boolean;
  completeOverlayPositionInteraction(requestId: string): boolean;
  applyOverlayPositionState(state: SidebarOverlayPositionAuthorityState): boolean;
  finishOverlayPositionSave(result: SidebarOverlayPositionSaveResult): boolean;
}

interface Window {
  createSubTandemSidebarState(profiles?: SidebarStateProfile[]): SidebarStateCoordinator;
}

function createSubTandemSidebarState(
  initialProfiles: SidebarStateProfile[] = [],
): SidebarStateCoordinator {
  const snapshot: SidebarStateSnapshot = {
    profiles: [...initialProfiles],
    deletedProfileIds: [],
    editingProfileId: null,
    selectedProfileId: null,
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
    modelControl: {
      value: "",
      mode: "custom",
      knownModelIds: [],
      contextKey: "",
      refreshState: "idle",
      refreshMessage: "",
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
    return snapshot.profiles;
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
    const position = snapshot.profiles.findIndex(
      (profile) => profile.profileId === input.profileId,
    );
    const localDelete =
      request?.actionId === "delete" &&
      request.profileId === input.profileId &&
      position >= 0 &&
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
      ? "Profile updated. Select it again for translation."
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

  let customModelSelected = false;

  const setModelContext = (contextKey: string, value: string): void => {
    if (snapshot.modelControl.value !== value) customModelSelected = false;
    if (snapshot.modelControl.contextKey !== contextKey) {
      snapshot.modelControl.contextKey = contextKey;
      snapshot.modelControl.knownModelIds = [];
      snapshot.modelControl.refreshState = "idle";
      snapshot.modelControl.refreshMessage = "";
    }
    snapshot.modelControl.value = value;
    if (customModelSelected) snapshot.modelControl.mode = "custom";
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
    snapshot.modelControl.refreshState = "success";
    if (customModelSelected) snapshot.modelControl.mode = "custom";
    else classifyModelValue();
    return true;
  };

  const selectKnownModel = (value: string): void => {
    customModelSelected = false;
    snapshot.modelControl.value = value;
    classifyModelValue();
  };

  const selectCustomModel = (): void => {
    customModelSelected = true;
    snapshot.modelControl.mode = "custom";
  };

  const inputCustomModelValue = (value: string): void => {
    customModelSelected = true;
    snapshot.modelControl.value = value;
    snapshot.modelControl.mode = "custom";
  };

  const setModelRefreshState = (state: ModelControlState["refreshState"], message = ""): void => {
    snapshot.modelControl.refreshState = state;
    snapshot.modelControl.refreshMessage = message;
  };

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

  return {
    snapshot,
    applyProfiles,
    setProfileContext,
    setProfileTest,
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
    selectKnownModel,
    selectCustomModel,
    inputCustomModelValue,
    previewOverlayPosition,
    beginOverlayPositionSave,
    completeOverlayPositionInteraction,
    applyOverlayPositionState,
    finishOverlayPositionSave,
  };
}

(globalThis as typeof globalThis & Window).createSubTandemSidebarState =
  createSubTandemSidebarState;
