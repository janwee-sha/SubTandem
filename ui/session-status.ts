interface SessionFailureInput {
  category?: string;
  statusCode?: number;
  providerCode?: string;
  retryable?: boolean;
  userAction?: string;
}

type SessionPresentationStatus =
  | "disabled"
  | "waitingForSubtitle"
  | "waitingForConfiguration"
  | "preparing"
  | "running"
  | "partialFailure"
  | "serviceUnavailable";

type SessionSourcePreparationState =
  | "preparing"
  | "ready"
  | "unsupportedType"
  | "remoteUnsupported"
  | "emptyOrUnreadable"
  | "timedOut"
  | "failed"
  | "invalidated";

interface SessionPresentationInput {
  status?: SessionPresentationStatus;
  providerError?: SessionFailureInput | null;
  sourceIssue?: string | null;
  source?: { format: string; cueCount: number } | null;
  sourcePreparation?: {
    state: SessionSourcePreparationState;
    canRetry?: boolean;
  } | null;
}

interface SessionPresentation {
  message: LocalizedFeedback;
  state: string;
  signature: string;
}

interface SessionSourceDetails {
  source: { format: string; cueCount: number } | null;
  retryAvailable: boolean;
  detailsVisible: boolean;
}

interface Window {
  subtandemServiceFailureFeedback(
    error: SessionFailureInput | null | undefined,
  ): LocalizedFeedback | null;
  subtandemSessionFailureFeedback(
    error: SessionFailureInput | null | undefined,
  ): LocalizedFeedback | null;
  subtandemResolveSessionPresentation(input: SessionPresentationInput): SessionPresentation | null;
  subtandemResolveSessionSourceDetails(input: SessionPresentationInput): SessionSourceDetails;
  subtandemSubtitleFormatLabel(format: string): string;
}

const subtitleFormatLabels: Record<string, string> = {
  srt: "SRT (SubRip)",
  subrip: "SRT (SubRip)",
  ass: "ASS (Advanced SubStation Alpha)",
  ssa: "SSA (SubStation Alpha)",
};

function subtitleFormatLabel(format: string): string {
  if (format === "mov_text")
    return (globalThis as typeof globalThis & Window).subtandemLocalization.format(
      "sidebar.mp4TimedText",
    );
  return (
    subtitleFormatLabels[format] ??
    (globalThis as typeof globalThis & Window).subtandemLocalization.format(
      "sidebar.unknownSubtitleFormat",
    )
  );
}

const sessionStatusLabels: Partial<Record<SessionPresentationStatus, LocalizedFeedback>> = {
  disabled: (globalThis as typeof globalThis & Window).subtandemLocalization.message(
    "sidebar.translationIsOff",
  ),
  waitingForSubtitle: (globalThis as typeof globalThis & Window).subtandemLocalization.message(
    "sidebar.selectAReadableExternalSRTOrASS",
  ),
  waitingForConfiguration: (globalThis as typeof globalThis & Window).subtandemLocalization.message(
    "sidebar.noTranslationServiceEnabledEnableOneTo",
  ),
  preparing: (globalThis as typeof globalThis & Window).subtandemLocalization.message(
    "sidebar.preparingNearbyTranslations",
  ),
  running: (globalThis as typeof globalThis & Window).subtandemLocalization.message(
    "sidebar.translationsAreRunning",
  ),
};

const sessionSourceIssueLabels: Record<string, LocalizedFeedback> = {
  "not-external": (globalThis as typeof globalThis & Window).subtandemLocalization.message(
    "sidebar.selectAnExternalSRTOrASSSubtitle",
  ),
  unreadable: (globalThis as typeof globalThis & Window).subtandemLocalization.message(
    "sidebar.iinaHasNotExposedReadableSubtitleData",
  ),
  "unsupported-format": (globalThis as typeof globalThis & Window).subtandemLocalization.message(
    "sidebar.theSelectedExternalSubtitleIsNotReadable",
  ),
  "unsupported-encoding": (globalThis as typeof globalThis & Window).subtandemLocalization.message(
    "sidebar.theSelectedSubtitleEncodingIsNotSupported",
  ),
  empty: (globalThis as typeof globalThis & Window).subtandemLocalization.message(
    "sidebar.theSelectedSubtitleContainsNoReadableCues",
  ),
};

const sessionSourcePreparationLabels: Record<
  SessionSourcePreparationState,
  LocalizedFeedback | null
> = {
  preparing: (globalThis as typeof globalThis & Window).subtandemLocalization.message(
    "sidebar.preparingTheSelectedEmbeddedSubtitle",
  ),
  ready: null,
  unsupportedType: (globalThis as typeof globalThis & Window).subtandemLocalization.message(
    "sidebar.subtitleTypeNotSupportedSelectAText",
  ),
  remoteUnsupported: (globalThis as typeof globalThis & Window).subtandemLocalization.message(
    "sidebar.embeddedSubtitlesInRemoteMediaAreNot",
  ),
  emptyOrUnreadable: (globalThis as typeof globalThis & Window).subtandemLocalization.message(
    "sidebar.theSelectedSubtitleIsEmptyOrUnreadable",
  ),
  timedOut: (globalThis as typeof globalThis & Window).subtandemLocalization.message(
    "sidebar.subtitlePreparationTimedOutPlaybackContinues",
  ),
  failed: (globalThis as typeof globalThis & Window).subtandemLocalization.message(
    "sidebar.subtitlePreparationFailedPlaybackContinues",
  ),
  invalidated: (globalThis as typeof globalThis & Window).subtandemLocalization.message(
    "sidebar.theSubtitleSelectionChangedReselectASubtitle",
  ),
};

function presentation(
  message: LocalizedFeedback | null | undefined,
  state: string,
): SessionPresentation {
  const resolved =
    message ??
    (globalThis as typeof globalThis & Window).subtandemLocalization.message("feedback.generic");
  return {
    message: resolved,
    state,
    signature: `${state}\u0000${resolved.messageKey}\u0000${JSON.stringify(resolved.params)}`,
  };
}

function resolveSessionPresentation(input: SessionPresentationInput): SessionPresentation | null {
  if (input.status === "disabled") return presentation(sessionStatusLabels.disabled!, "disabled");
  if (input.sourcePreparation && input.sourcePreparation.state !== "ready")
    return presentation(
      sessionSourcePreparationLabels[input.sourcePreparation.state],
      input.sourcePreparation.state,
    );
  const sourceIssueText = input.sourceIssue
    ? sessionSourceIssueLabels[input.sourceIssue]
    : undefined;
  if (sourceIssueText) return presentation(sourceIssueText, "waitingForSubtitle");
  if (input.status === "waitingForConfiguration" || input.status === "waitingForSubtitle")
    return presentation(sessionStatusLabels[input.status]!, input.status);
  if (input.status === "partialFailure" || input.status === "serviceUnavailable") {
    const text = (globalThis as typeof globalThis & Window).subtandemServiceFailureFeedback(
      input.providerError,
    );
    return text ? presentation(text, input.status) : null;
  }
  if (input.status === "running" || input.status === "preparing")
    return presentation(sessionStatusLabels[input.status]!, input.status);
  return input.status === undefined ? null : presentation(null, "unknown");
}

function resolveSessionSourceDetails(input: SessionPresentationInput): SessionSourceDetails {
  if (
    input.status === "disabled" ||
    (input.sourcePreparation && input.sourcePreparation.state !== "ready")
  )
    return { source: null, retryAvailable: false, detailsVisible: false };
  return {
    source: input.source ?? null,
    retryAvailable:
      input.sourcePreparation?.state !== "ready" && input.sourcePreparation?.canRetry === true,
    detailsVisible: true,
  };
}

(globalThis as typeof globalThis & Window).subtandemSessionFailureFeedback = (
  globalThis as typeof globalThis & Window
).subtandemServiceFailureFeedback;
(globalThis as typeof globalThis & Window).subtandemResolveSessionPresentation =
  resolveSessionPresentation;
(globalThis as typeof globalThis & Window).subtandemResolveSessionSourceDetails =
  resolveSessionSourceDetails;
(globalThis as typeof globalThis & Window).subtandemSubtitleFormatLabel = subtitleFormatLabel;
