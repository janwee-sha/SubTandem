import { PlaybackController } from "./app/controller.js";
import { GlobalProviderClient } from "./adapters/iina/global-provider-client.js";
import { finitePosition } from "./adapters/iina/runtime.js";
import {
  SubtitleExtractorClient,
  SubtitleExtractorProcess,
  discoverSubtitleExtractorExecutable,
} from "./adapters/iina/subtitle-extractor.js";
import {
  classifySubtitleSelection,
  IinaSubtitleSourcePort,
  readSelectedSubtitle,
} from "./adapters/iina/subtitle-source.js";
import { IinaLocalHttpBridge, IinaProcessLauncher } from "./adapters/iina/provider-transport.js";
import { WebViewTranslationOverlay } from "./adapters/iina/webview-translation-overlay.js";
import { SubtitlePreparationCoordinator } from "./app/subtitle-preparation.js";
import { LanguageDetectionCoordinator } from "./app/language-detection.js";
import {
  parseProviderModelsRequest,
  parseProviderModelsPreviewRequest,
  parseProviderModelsResult,
  parseRetrySubtitlePreparation,
  parseLanguageOperationError,
  parseOverlayPositionPreview,
  parseOverlayPositionSave,
  parseOverlayPositionSaveResult,
  parseOverlayPositionState,
  parseSubtitleStyleEdit,
  parseSubtitleStyleGet,
  parseSubtitleStylePickerOpen,
  parseSubtitleStylePickerResult,
  parseSubtitleStyleSaveResult,
  parseSubtitleStyleState,
  parseTargetLanguageSave,
  parseTargetLanguageSaved,
} from "./domain/messages.js";
import {
  ModelCatalogSync,
  modelCatalogContextToken,
  modelCatalogPreviewContextToken,
} from "./adapters/iina/model-catalog-sync.js";
import { TARGET_LANGUAGES } from "./domain/target-languages.js";
import { TargetLanguagePreferences } from "./adapters/iina/target-language-preferences.js";
import { TargetLanguageSession } from "./app/target-language-session.js";
import { OverlayPositionFollower } from "./adapters/iina/overlay-position-sync.js";
import { SubtitleStyleFollower } from "./adapters/iina/subtitle-style-sync.js";
import {
  DEFAULT_SUBTITLE_TEXT_STYLE,
  withSubtitleStyleField,
  type SubtitleTextStyle,
} from "./domain/subtitle-style.js";
import { OverlayRegionRuntime } from "./adapters/iina/overlay-region-runtime.js";
import {
  acceptProfileListResult,
  beginProfileListRequest,
  createProfileListSyncState,
  markProfileCredentialConfigured,
  removeDeletedProfile,
  upsertCreatedProfile,
} from "./adapters/iina/profile-list-sync.js";
import type {
  PreparedSubtitleSource,
  SourcePreparationView,
  SubtitleTrackIdentity,
} from "./subtitles/types.js";

interface MainRuntime {
  console: IINA.API.Console;
  core: IINA.API.Core;
  event: IINA.API.Event;
  file: IINA.API.File;
  global: IINA.API.Global;
  http: IINA.API.HTTP;
  mpv: IINA.API.MPV;
  overlay: IINA.API.Overlay;
  preferences: IINA.API.Preferences;
  sidebar: IINA.API.SidebarView;
  utils: IINA.API.Utils;
}

function wirePlayer(runtime: MainRuntime, playerId: string): PlaybackController {
  const provider = new GlobalProviderClient(runtime.global);
  let mediaEpoch = 0;
  const sourcePort = new IinaSubtitleSourcePort(
    runtime.core.subtitle,
    runtime.file,
    runtime.core,
    runtime.mpv,
    playerId,
    () => mediaEpoch,
  );
  const translationOverlay = new WebViewTranslationOverlay(
    runtime.overlay,
    runtime.event,
    (message) => runtime.console.log(message),
  );
  const overlayRegion = new OverlayRegionRuntime(runtime.mpv, runtime.core.window.fullscreen);
  const overlayPosition = new OverlayPositionFollower();
  const subtitleStyle = new SubtitleStyleFollower();
  const restoredTarget = new TargetLanguagePreferences(runtime.preferences).read();
  const targetLanguageSession = new TargetLanguageSession(restoredTarget.targetLanguage);
  const languageDetection = new LanguageDetectionCoordinator();
  let selectedSourceTrackId: number | null = null;
  let selectedSourceContentHash: string | null = null;
  let sourceSelectionTimer: ReturnType<typeof setTimeout> | null = null;
  let sourceReloadAttempt = 0;
  let preparation: SubtitlePreparationCoordinator | null = null;
  let preparationPromise: Promise<SubtitlePreparationCoordinator> | null = null;
  let preparationView: SourcePreparationView | null = null;
  let embeddedPreparationKey: string | null = null;
  const controller = new PlaybackController({
    playerId,
    provider,
    overlay: translationOverlay,
    targetLanguage: targetLanguageSession.snapshot.targetLanguage,
    requiresProviderSelection: true,
    translationLog: (message) => runtime.console.log(message),
  });
  controller.setEnabled(runtime.preferences.get("enabledByDefault") === true);
  let currentSelection: {
    profileId: string;
    revision: number;
    endpointFingerprint: string;
    kind: "openai" | "claude" | "deepseek" | "ollama";
  } | null = null;
  const boundedWork = "120 s / 40 cues; 25 cues / 5,000 code points per request";
  let sidebarState: Record<string, unknown> = {
    status: controller.status,
    cacheSize: controller.cacheSize,
    providerError: controller.providerError,
    boundedWork,
    source: null,
    sourceIssue: "unreadable",
    sourcePreparation: null,
    targetLanguage: targetLanguageSession.snapshot.targetLanguage,
    targetLanguageRevision: targetLanguageSession.snapshot.revision,
    targetLanguages: TARGET_LANGUAGES,
    overlayPosition: overlayPosition.snapshot,
    subtitleStyle: subtitleStyle.snapshot,
  };
  const sidebarMessages: Array<{ name: string; data: unknown }> = [];
  let profileListState = createProfileListSyncState<{
    profileId: string;
    credentialConfigured?: boolean;
    [key: string]: unknown;
  }>();
  const modelCatalogSync = new ModelCatalogSync();

  const effectiveSubtitleStyle = (): SubtitleTextStyle => {
    const state = subtitleStyle.snapshot;
    if (!state) return { ...DEFAULT_SUBTITLE_TEXT_STYLE };
    return {
      ...state.liveStyle,
      fontFamily: state.fontResolution.effectiveFamily,
    };
  };

  const updateSidebarState = (patch: Record<string, unknown> = {}): void => {
    sidebarState = {
      ...sidebarState,
      status: controller.status,
      cacheSize: controller.cacheSize,
      providerError: controller.providerError,
      boundedWork,
      sourcePreparation: preparation?.view ?? preparationView,
      targetLanguage: targetLanguageSession.snapshot.targetLanguage,
      targetLanguageRevision: targetLanguageSession.snapshot.revision,
      targetLanguages: TARGET_LANGUAGES,
      overlayPosition: overlayPosition.snapshot,
      subtitleStyle: subtitleStyle.snapshot,
      ...patch,
    };
  };

  const queueSidebarMessage = (name: string, data: unknown): void => {
    sidebarMessages.push({ name, data });
    if (sidebarMessages.length > 32) sidebarMessages.shift();
  };

  const requestProfiles = (): void => {
    const request = beginProfileListRequest(profileListState, playerId);
    profileListState = request.state;
    runtime.global.postMessage("profiles:list", {
      requestId: request.requestId,
      revision: 1,
      payload: {},
    });
  };

  const requestOverlayPosition = (): void => {
    runtime.global.postMessage("overlay-position:get", {
      requestId: `overlay-position.init.${playerId}`,
      revision: 1,
      payload: {},
    });
  };

  const requestSubtitleStyle = (): void => {
    runtime.global.postMessage("subtitle-style:get", {
      requestId: `subtitle-style.init.${playerId}`,
      revision: 1,
      payload: {},
    });
  };

  // Only post while handling a message sent by the live webview. IINA 1.4.4
  // traps in native code if a background callback posts after the sidebar has
  // been torn down during a plugin reload.
  const flushSidebar = (): void => {
    runtime.sidebar.postMessage("state:update", sidebarState);
    for (const message of sidebarMessages.splice(0)) {
      runtime.sidebar.postMessage(message.name, message.data);
    }
  };

  const invalidatePreparation = (): void => {
    preparation?.invalidate("invalidated");
    preparationView = null;
    embeddedPreparationKey = null;
  };

  const clearSource = (reason: string, invalidateEmbedded = true): void => {
    if (invalidateEmbedded) invalidatePreparation();
    languageDetection.invalidate();
    selectedSourceTrackId = runtime.core.subtitle.id;
    selectedSourceContentHash = null;
    controller.setSource(null);
    updateSidebarState({ source: null, sourceIssue: reason, sourcePreparation: preparationView });
  };

  const detectLanguage = (
    trackIdentity: string,
    contentHash: string,
    cues: PreparedSubtitleSource["cues"],
  ): void => {
    void languageDetection.start(
      { playerId, mediaEpoch, trackIdentity, contentHash, cues },
      (result) => {
        if (selectedSourceContentHash !== result.contentHash) return;
        if (result.state === "reliable")
          controller.setLanguageDetection({ languageId: result.languageId });
        else controller.setLanguageDetection(result.state);
        const currentSource =
          sidebarState.source && typeof sidebarState.source === "object"
            ? (sidebarState.source as Record<string, unknown>)
            : null;
        updateSidebarState({
          source: currentSource
            ? {
                ...currentSource,
                detectedLanguage: result.state === "reliable" ? result.languageId : null,
              }
            : null,
        });
      },
    );
  };

  const preparationKey = (track: SubtitleTrackIdentity, epoch: number): string =>
    [epoch, track.trackId, track.codec, track.ffIndex ?? "", track.sourceId ?? ""].join(":");

  const coordinator = (): Promise<SubtitlePreparationCoordinator> => {
    if (preparation) return Promise.resolve(preparation);
    if (preparationPromise) return preparationPromise;
    preparationPromise = (async () => {
      const executable = discoverSubtitleExtractorExecutable({
        exists: (path) => runtime.file.exists(path),
        resolvePath: (path) => runtime.utils.resolvePath(path),
        list: (path) => runtime.file.list(path, { includeSubDir: false }),
        read: (path) => runtime.file.read(path) ?? null,
      });
      const session = await SubtitleExtractorProcess.bootstrap(
        new IinaProcessLauncher(runtime.utils),
        { tempDirectory: runtime.utils.resolvePath("@tmp/subtandem-extraction") },
        executable,
      );
      preparation = new SubtitlePreparationCoordinator({
        playerId,
        extractor: new SubtitleExtractorClient(session, new IinaLocalHttpBridge(runtime.http)),
        readResult: (resultId) =>
          sourcePort.readBinary(`@tmp/subtandem-extraction/${resultId}/output.srt`),
      });
      return preparation;
    })();
    void preparationPromise.catch(() => {
      preparationPromise = null;
    });
    return preparationPromise;
  };

  const acceptPrepared = (key: string, prepared: PreparedSubtitleSource | null): void => {
    preparationView = preparation?.view ?? null;
    if (!prepared || embeddedPreparationKey !== key) {
      updateSidebarState({ sourcePreparation: preparationView });
      return;
    }
    const currentSnapshot = sourcePort.selectionSnapshot();
    const current = currentSnapshot ? classifySubtitleSelection(currentSnapshot) : null;
    if (
      current?.kind !== "embedded" ||
      preparationKey(current.track, current.media.mediaEpoch) !== key
    ) {
      preparation?.invalidate("invalidated");
      return;
    }
    selectedSourceContentHash = prepared.contentHash;
    controller.setSource({
      cues: prepared.cues,
      contentHash: prepared.contentHash,
      language: null,
      format: "srt",
    });
    detectLanguage(
      `${prepared.trackId}:embedded:${prepared.codec}`,
      prepared.contentHash,
      prepared.cues,
    );
    updateSidebarState({
      source: {
        format: prepared.codec,
        cueCount: prepared.cues.length,
        detectedLanguage: null,
        warnings: [],
      },
      sourceIssue: null,
      sourcePreparation: preparation?.view ?? preparationView,
    });
  };

  const loadEmbedded = (
    media: Parameters<SubtitlePreparationCoordinator["prepare"]>[0],
    track: Parameters<SubtitlePreparationCoordinator["prepare"]>[1],
  ): void => {
    const key = preparationKey(track, media.mediaEpoch);
    if (
      embeddedPreparationKey === key &&
      (preparation?.view?.state === "preparing" || preparation?.view?.state === "ready")
    )
      return;
    invalidatePreparation();
    embeddedPreparationKey = key;
    selectedSourceTrackId = track.trackId;
    selectedSourceContentHash = null;
    controller.setSource(null);
    preparationView = {
      state: "preparing",
      origin: "embedded",
      ...(track.codec === "external" ? {} : { codec: track.codec }),
      canRetry: false,
      canReselect: true,
    };
    updateSidebarState({ source: null, sourceIssue: null, sourcePreparation: preparationView });
    void coordinator()
      .then((value) => value.prepare(media, track))
      .then((prepared) => acceptPrepared(key, prepared))
      .catch(() => {
        if (embeddedPreparationKey !== key) return;
        preparationView = {
          state: "failed",
          origin: "embedded",
          ...(track.codec === "external" ? {} : { codec: track.codec }),
          canRetry: true,
          canReselect: true,
        };
        updateSidebarState({ source: null, sourceIssue: null, sourcePreparation: preparationView });
      });
  };

  const loadSource = (commitFailure = true): boolean => {
    const snapshot = sourcePort.selectionSnapshot();
    const selection = snapshot ? classifySubtitleSelection(snapshot) : null;
    if (selection?.kind === "embedded") {
      loadEmbedded(selection.media, selection.track);
      return true;
    }
    if (selection?.kind === "unsupported") {
      invalidatePreparation();
      preparationView = {
        state: selection.state,
        origin: "embedded",
        ...(selection.track?.codec && selection.track.codec !== "external"
          ? { codec: selection.track.codec }
          : {}),
        canRetry: selection.state === "emptyOrUnreadable",
        canReselect: true,
      };
      controller.setSource(null);
      updateSidebarState({ source: null, sourceIssue: null, sourcePreparation: preparationView });
      return true;
    }
    invalidatePreparation();
    const loaded = readSelectedSubtitle(sourcePort);
    if (!loaded.ok) {
      if (commitFailure) clearSource(loaded.reason);
      return false;
    }
    const unchanged =
      selectedSourceTrackId === loaded.source.trackId &&
      selectedSourceContentHash === loaded.source.contentHash;
    selectedSourceTrackId = loaded.source.trackId;
    selectedSourceContentHash = loaded.source.contentHash;
    if (!unchanged)
      controller.setSource({
        cues: loaded.source.cues,
        contentHash: loaded.source.contentHash,
        language: null,
        format: loaded.source.format,
      });
    if (!unchanged)
      detectLanguage(
        `${loaded.source.trackId}:external`,
        loaded.source.contentHash,
        loaded.source.cues,
      );
    updateSidebarState({
      source: {
        format: loaded.source.format,
        cueCount: loaded.source.cues.length,
        detectedLanguage: null,
        warnings: loaded.source.decode.warnings,
      },
      sourceIssue: null,
      sourcePreparation: null,
    });
    return true;
  };

  const attemptSourceReload = (): void => {
    sourceSelectionTimer = null;
    const finalAttempt = sourceReloadAttempt >= 4;
    if (loadSource(finalAttempt) || finalAttempt) return;
    sourceReloadAttempt += 1;
    sourceSelectionTimer = setTimeout(attemptSourceReload, 250);
  };

  const scheduleSourceReload = (invalidateChangedSelection = false): void => {
    const selectedId = runtime.core.subtitle.id;
    if (invalidateChangedSelection && selectedId !== selectedSourceTrackId)
      clearSource("unreadable");
    if (sourceSelectionTimer !== null) clearTimeout(sourceSelectionTimer);
    sourceReloadAttempt = 0;
    sourceSelectionTimer = setTimeout(attemptSourceReload, 250);
  };

  // IINA clears the sidebar message hub when loadFile() is called, so load the
  // webview before registering any of its message handlers.
  runtime.sidebar.loadFile("dist/ui/sidebar.html");
  runtime.sidebar.onMessage("ui:ready", () => {
    if (!loadSource(false)) scheduleSourceReload();
    requestProfiles();
    requestOverlayPosition();
    requestSubtitleStyle();
    flushSidebar();
  });
  runtime.sidebar.onMessage("ui:poll", () => {
    updateSidebarState();
    flushSidebar();
  });
  runtime.sidebar.onMessage("overlay-position:preview", (raw: unknown) => {
    try {
      const message = parseOverlayPositionPreview(raw);
      translationOverlay.setPosition(message.payload.position);
      runtime.global.postMessage("overlay-position:preview", message);
    } catch {
      return;
    }
  });
  runtime.sidebar.onMessage("overlay-position:save", (raw: unknown) => {
    try {
      const message = parseOverlayPositionSave(raw);
      translationOverlay.setPosition(message.payload.position);
      runtime.global.postMessage("overlay-position:save", message);
    } catch {
      return;
    }
  });
  runtime.sidebar.onMessage("subtitle-style:get", (raw: unknown) => {
    try {
      runtime.global.postMessage("subtitle-style:get", parseSubtitleStyleGet(raw));
    } catch {
      return;
    }
  });
  runtime.sidebar.onMessage("subtitle-style:edit", (raw: unknown) => {
    try {
      const message = parseSubtitleStyleEdit(raw);
      const localStyle = withSubtitleStyleField(
        effectiveSubtitleStyle(),
        message.payload.field,
        message.payload.value,
      );
      translationOverlay.setStyle(localStyle);
      runtime.global.postMessage("subtitle-style:edit", message);
    } catch {
      return;
    }
  });
  runtime.sidebar.onMessage("subtitle-style:picker-open", (raw: unknown) => {
    try {
      runtime.global.postMessage("subtitle-style:picker-open", parseSubtitleStylePickerOpen(raw));
    } catch {
      return;
    }
  });
  runtime.sidebar.onMessage("translation:set-enabled", (raw: unknown) => {
    const enabled = Boolean((raw as { payload?: { enabled?: unknown } }).payload?.enabled);
    controller.setEnabled(enabled);
    if (!enabled) {
      languageDetection.invalidate();
      clearSource("unreadable");
    } else if (!loadSource(false)) scheduleSourceReload();
    runtime.preferences.set("enabledByDefault", enabled);
    runtime.preferences.sync();
    updateSidebarState();
    queueSidebarMessage("operation:result", {
      requestId: (raw as { requestId?: unknown }).requestId,
      ok: true,
      action: "translation",
    });
    flushSidebar();
  });
  runtime.sidebar.onMessage("subtitle:retry-preparation", (raw: unknown) => {
    let requestId: string | undefined;
    try {
      const message = parseRetrySubtitlePreparation(raw);
      requestId = message.requestId;
      const snapshot = sourcePort.selectionSnapshot();
      const selection = snapshot ? classifySubtitleSelection(snapshot) : null;
      if (selection?.kind !== "embedded") throw new Error("INVALID_RETRY");
      const key = preparationKey(selection.track, selection.media.mediaEpoch);
      if (!preparation || preparation.view?.canRetry !== true || key !== embeddedPreparationKey)
        throw new Error("INVALID_RETRY");
      preparationView = {
        state: "preparing",
        origin: "embedded",
        ...(selection.track.codec === "external" ? {} : { codec: selection.track.codec }),
        canRetry: false,
        canReselect: true,
      };
      updateSidebarState({ source: null, sourceIssue: null, sourcePreparation: preparationView });
      void preparation.retry().then((prepared) => acceptPrepared(key, prepared));
      queueSidebarMessage("operation:result", {
        requestId,
        ok: true,
        action: "retry-preparation",
      });
    } catch {
      queueSidebarMessage("operation:result", {
        requestId,
        ok: false,
        action: "retry-preparation",
      });
    }
    flushSidebar();
  });
  runtime.sidebar.onMessage("defaults:save", (raw: unknown) => {
    try {
      const message = parseTargetLanguageSave(raw);
      if (
        !targetLanguageSession.begin({
          requestId: message.requestId,
          revision: message.revision,
          targetLanguage: message.payload.targetLanguage,
        })
      )
        throw new Error("LANGUAGE_SAVE_NOT_AVAILABLE");
      updateSidebarState({ languageSavePending: true });
      runtime.global.postMessage("defaults:save", message);
    } catch {
      const requestId = (raw as { requestId?: unknown }).requestId;
      if (typeof requestId === "string") targetLanguageSession.fail(requestId);
      queueSidebarMessage("operation:result", {
        requestId,
        ok: false,
        action: "languages",
      });
    }
    flushSidebar();
  });

  const forward: Array<[string, string]> = [
    ["profile:save", "profile:create-revision"],
    ["secret:set", "credential:set"],
    ["profile:select", "profile:select"],
    ["provider:test", "provider:test"],
  ];
  for (const [sidebarName, globalName] of forward) {
    runtime.sidebar.onMessage(sidebarName, (raw: unknown) =>
      runtime.global.postMessage(globalName, raw),
    );
  }
  runtime.sidebar.onMessage("provider:models", (raw: unknown) => {
    try {
      const message = parseProviderModelsRequest(raw);
      const started = modelCatalogSync.begin(playerId, {
        requestId: message.requestId,
        contextToken: modelCatalogContextToken(message.payload),
        trigger: message.payload.trigger,
      });
      if (started.forwarded) runtime.global.postMessage("provider:models", message);
    } catch {
      queueSidebarMessage("operation:error", {
        requestId: (raw as { requestId?: unknown })?.requestId,
        code: "INVALID_MESSAGE",
        userAction: "NONE",
      });
    }
  });
  runtime.sidebar.onMessage("provider:models-preview", (raw: unknown) => {
    try {
      const message = parseProviderModelsPreviewRequest(raw);
      const started = modelCatalogSync.begin(playerId, {
        requestId: message.requestId,
        contextToken: modelCatalogPreviewContextToken(message.payload),
        trigger: message.payload.trigger,
        cacheResult: false,
      });
      if (started.forwarded) runtime.global.postMessage("provider:models-preview", message);
    } catch {
      queueSidebarMessage("operation:error", {
        requestId: (raw as { requestId?: unknown })?.requestId,
        code: "INVALID_MESSAGE",
        userAction: "NONE",
      });
    }
  });
  runtime.sidebar.onMessage("profile:delete-request", (raw: unknown) => {
    const source = raw as {
      requestId?: unknown;
      revision?: unknown;
      payload?: { displayName?: unknown };
    };
    let confirmed = false;
    try {
      const displayName =
        typeof source.payload?.displayName === "string"
          ? source.payload.displayName
          : "this profile";
      confirmed = runtime.utils.ask(
        `Delete ${displayName}? Its saved credential will be permanently removed.`,
      );
    } catch {
      confirmed = false;
    }
    if (!confirmed) {
      queueSidebarMessage("operation:result", {
        requestId: source.requestId,
        ok: false,
        cancelled: true,
        action: "delete-profile",
      });
      flushSidebar();
      return;
    }
    runtime.global.postMessage("profile:delete", raw);
  });
  runtime.global.onMessage("profiles:result", (raw: unknown) => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return;
    const result = raw as { requestId?: unknown; profiles?: unknown };
    if (
      typeof result.requestId !== "string" ||
      !Array.isArray(result.profiles) ||
      !result.profiles.every(
        (profile) =>
          profile &&
          typeof profile === "object" &&
          typeof (profile as { profileId?: unknown }).profileId === "string",
      )
    )
      return;
    const accepted = acceptProfileListResult(
      profileListState,
      result.requestId,
      result.profiles as Array<{ profileId: string; [key: string]: unknown }>,
    );
    if (accepted === profileListState) return;
    profileListState = accepted;
    updateSidebarState({ profiles: profileListState.profiles });
  });
  runtime.global.onMessage("overlay-position:state", (raw: unknown) => {
    try {
      const state = parseOverlayPositionState(raw);
      if (!overlayPosition.apply(state)) return;
      translationOverlay.setPosition(state.position);
      updateSidebarState({ overlayPosition: overlayPosition.snapshot });
    } catch {
      return;
    }
  });
  runtime.global.onMessage("overlay-position:save-result", (raw: unknown) => {
    try {
      const result = parseOverlayPositionSaveResult(raw);
      const state = parseOverlayPositionState(
        result.ok
          ? {
              phase: "committed",
              position: result.position,
              committedPosition: result.position,
              intentSequence: result.intentSequence,
              committedRevision: result.committedRevision,
            }
          : {
              phase: "reverted",
              position: result.committedPosition,
              committedPosition: result.committedPosition,
              intentSequence: result.intentSequence,
              committedRevision: result.committedRevision,
            },
      );
      if (overlayPosition.apply(state)) {
        translationOverlay.setPosition(state.position);
        updateSidebarState({ overlayPosition: overlayPosition.snapshot });
      }
      queueSidebarMessage("operation:result", {
        ...result,
        action: "overlay-position",
      });
    } catch {
      return;
    }
  });
  runtime.global.onMessage("subtitle-style:state", (raw: unknown) => {
    try {
      const state = parseSubtitleStyleState(raw);
      if (!subtitleStyle.apply(state)) return;
      translationOverlay.setStyle(effectiveSubtitleStyle());
      updateSidebarState({ subtitleStyle: subtitleStyle.snapshot });
      queueSidebarMessage("subtitle-style:state", state);
    } catch {
      return;
    }
  });
  runtime.global.onMessage("subtitle-style:save-result", (raw: unknown) => {
    try {
      const result = parseSubtitleStyleSaveResult(raw);
      subtitleStyle.apply(result.authority);
      translationOverlay.setStyle(effectiveSubtitleStyle());
      updateSidebarState({ subtitleStyle: subtitleStyle.snapshot });
      queueSidebarMessage("subtitle-style:save-result", result);
    } catch {
      return;
    }
  });
  runtime.global.onMessage("subtitle-style:picker-result", (raw: unknown) => {
    try {
      const result = parseSubtitleStylePickerResult(raw);
      subtitleStyle.apply(result.authority);
      translationOverlay.setStyle(effectiveSubtitleStyle());
      updateSidebarState({ subtitleStyle: subtitleStyle.snapshot });
      queueSidebarMessage("subtitle-style:picker-result", result);
    } catch {
      return;
    }
  });
  runtime.global.onMessage("profile:revision-created", (raw: unknown) => {
    const result = raw as {
      selectionInvalidated?: unknown;
      profile?: { profileId?: unknown; [key: string]: unknown };
    };
    if (result.profile && typeof result.profile.profileId === "string") {
      profileListState = upsertCreatedProfile(
        profileListState,
        result.profile as { profileId: string; [key: string]: unknown },
      );
      updateSidebarState({ profiles: profileListState.profiles });
    }
    if (
      result.selectionInvalidated === true &&
      currentSelection &&
      result.profile?.profileId === currentSelection.profileId
    ) {
      runtime.global.postMessage("profile:release", {
        requestId: `release-${Date.now()}`,
        revision: 1,
        payload: currentSelection,
      });
      currentSelection = null;
      controller.clearProviderSelection();
      updateSidebarState({ selection: null });
    }
    queueSidebarMessage("profile:revision-created", raw);
  });
  runtime.global.onMessage("credential:result", (raw: unknown) => {
    const profileId =
      raw && typeof raw === "object" && !Array.isArray(raw)
        ? (raw as { profileId?: unknown }).profileId
        : undefined;
    if (typeof profileId === "string") {
      profileListState = markProfileCredentialConfigured(profileListState, profileId);
      updateSidebarState({ profiles: profileListState.profiles });
    }
    queueSidebarMessage("credential:state", raw);
  });
  runtime.global.onMessage("credential:state", (raw: unknown) =>
    queueSidebarMessage("credential:state", raw),
  );
  runtime.global.onMessage("provider:test-result", (raw: unknown) =>
    queueSidebarMessage("provider:test-result", raw),
  );
  runtime.global.onMessage("provider:models-result", (raw: unknown) => {
    try {
      const result = parseProviderModelsResult(raw);
      if (modelCatalogSync.commit(playerId, result))
        queueSidebarMessage("provider:models-result", result);
    } catch {
      return;
    }
  });
  runtime.global.onMessage("defaults:saved", (raw: unknown) => {
    try {
      const result = parseTargetLanguageSaved(raw);
      const committed = targetLanguageSession.commit(result);
      if (!committed) return;
      controller.setTargetLanguage(committed.targetLanguage);
      updateSidebarState({ languageSavePending: false });
      queueSidebarMessage("operation:result", {
        requestId: result.requestId,
        ok: true,
        action: "languages",
        targetLanguage: committed.targetLanguage,
        targetLanguageRevision: committed.revision,
      });
    } catch (error) {
      void error;
    }
  });
  runtime.global.onMessage("operation:error", (raw: unknown) => {
    try {
      const result = parseLanguageOperationError(raw);
      if (targetLanguageSession.fail(result.requestId)) {
        updateSidebarState({ languageSavePending: false });
        queueSidebarMessage("operation:result", {
          requestId: result.requestId,
          ok: false,
          action: "languages",
        });
        return;
      }
    } catch (error) {
      void error;
    }
    queueSidebarMessage("operation:error", raw);
  });
  runtime.global.onMessage("profile:selected", (raw: unknown) => {
    const selection = (
      raw as {
        selection?: {
          profileId?: unknown;
          revision?: unknown;
          endpointFingerprint?: unknown;
          kind?: unknown;
        };
      }
    ).selection;
    if (
      !selection ||
      typeof selection.profileId !== "string" ||
      typeof selection.revision !== "number" ||
      typeof selection.endpointFingerprint !== "string" ||
      (selection.kind !== "openai" &&
        selection.kind !== "claude" &&
        selection.kind !== "deepseek" &&
        selection.kind !== "ollama")
    )
      return;
    if (currentSelection) {
      runtime.global.postMessage("profile:release", {
        requestId: `release-${Date.now()}`,
        revision: 1,
        payload: currentSelection,
      });
    }
    currentSelection = {
      profileId: selection.profileId,
      revision: selection.revision,
      endpointFingerprint: selection.endpointFingerprint,
      kind: selection.kind,
    };
    controller.setProviderSelection({
      ...currentSelection,
      kind: currentSelection.kind,
    });
    updateSidebarState({
      selection: currentSelection,
    });
    queueSidebarMessage("profile:selected", raw);
  });
  runtime.global.onMessage("profile:deleted", (raw: unknown) => {
    const result = raw as { profileId?: unknown; selectionInvalidated?: unknown };
    profileListState = removeDeletedProfile(profileListState, String(result.profileId ?? ""));
    if (
      result.selectionInvalidated === true ||
      (currentSelection && result.profileId === currentSelection.profileId)
    ) {
      currentSelection = null;
      controller.clearProviderSelection();
      updateSidebarState({ selection: null, profiles: profileListState.profiles });
    } else {
      updateSidebarState({ profiles: profileListState.profiles });
    }
    queueSidebarMessage("profile:deleted", raw);
    requestProfiles();
  });
  requestProfiles();

  runtime.event.on("iina.file-loaded", () => {
    mediaEpoch += 1;
    invalidatePreparation();
    controller.endFile();
    clearSource("unreadable");
    scheduleSourceReload();
  });
  runtime.event.on("mpv.sid.changed", () => {
    const selectedId = runtime.core.subtitle.id;
    if (selectedId === selectedSourceTrackId) return;
    scheduleSourceReload(true);
  });
  runtime.event.on("mpv.track-list.changed", () => scheduleSourceReload());
  const overlayRegionListeners = [
    {
      name: "mpv.sub-margin-x.changed",
      id: runtime.event.on("mpv.sub-margin-x.changed", () =>
        translationOverlay.setRegion(overlayRegion.refreshMarginX()),
      ),
    },
    {
      name: "mpv.sub-margin-y.changed",
      id: runtime.event.on("mpv.sub-margin-y.changed", () =>
        translationOverlay.setRegion(overlayRegion.refreshMarginY()),
      ),
    },
    {
      name: "mpv.sub-margin-y-offset.changed",
      id: runtime.event.on("mpv.sub-margin-y-offset.changed", () =>
        translationOverlay.setRegion(overlayRegion.refreshMarginYOffset()),
      ),
    },
    {
      name: "iina.window-fs.changed",
      id: runtime.event.on("iina.window-fs.changed", (fullscreen) =>
        translationOverlay.setRegion(overlayRegion.setFullscreen(fullscreen)),
      ),
    },
  ];
  const overlayRegionTimer = setInterval(() => {
    const region = overlayRegion.pollDynamicInputs();
    if (region) translationOverlay.setRegion(region);
  }, 100);
  let overlayRegionClosed = false;
  const closeOverlayRegion = (): void => {
    if (overlayRegionClosed) return;
    overlayRegionClosed = true;
    clearInterval(overlayRegionTimer);
    for (const listener of overlayRegionListeners) runtime.event.off(listener.name, listener.id);
    overlayRegion.close();
  };
  runtime.event.on("mpv.shutdown", closeOverlayRegion);
  runtime.event.on("mpv.seek", () => {
    preparation?.onSeek();
    languageDetection.onSeek();
    controller.onSeek(
      finitePosition(
        runtime.core.status.position === null ? null : runtime.core.status.position * 1_000,
      ),
    );
  });
  runtime.event.on("mpv.end-file", () => {
    mediaEpoch += 1;
    invalidatePreparation();
    languageDetection.invalidate();
  });
  runtime.event.on("mpv.end-file", () => controller.endFile());
  setInterval(() => {
    controller.session.setPaused(runtime.core.status.paused);
    controller.tick(
      finitePosition(
        runtime.core.status.position === null ? null : runtime.core.status.position * 1_000,
      ),
    );
    updateSidebarState();
  }, 350);
  runtime.event.on("iina.window-will-close", () => {
    closeOverlayRegion();
    translationOverlay.close();
    runtime.global.postMessage("subtitle-style:picker-cancel", {
      requestId: `subtitle-style.close.${playerId}`,
      revision: 1,
      payload: {},
    });
    modelCatalogSync.remove(playerId);
    if (sourceSelectionTimer !== null) clearTimeout(sourceSelectionTimer);
    if (currentSelection)
      runtime.global.postMessage("profile:release", {
        requestId: `release-${Date.now()}`,
        revision: 1,
        payload: currentSelection,
      });
    currentSelection = null;
    languageDetection.invalidate();
    targetLanguageSession.close();
    selectedSourceTrackId = null;
    selectedSourceContentHash = null;
    void preparation?.shutdown();
    preparation = null;
    preparationPromise = null;
    preparationView = null;
    embeddedPreparationKey = null;
    controller.endFile();
    controller.clearProviderSelection();
    updateSidebarState({ source: null, sourceIssue: "unreadable", selection: null });
  });
  if (!loadSource(false)) scheduleSourceReload();
  translationOverlay.setRegion(overlayRegion.snapshot);
  requestOverlayPosition();
  requestSubtitleStyle();
  return controller;
}

let playerWired = false;
const initializePlayer = (): void => {
  if (playerWired || !iina.core.window.loaded) return;
  playerWired = true;
  wirePlayer(iina, `player-${Date.now()}`);
};
const scheduleInitializePlayer = (): void => {
  setTimeout(initializePlayer, 100);
};
iina.event.on("iina.window-loaded", scheduleInitializePlayer);
scheduleInitializePlayer();
