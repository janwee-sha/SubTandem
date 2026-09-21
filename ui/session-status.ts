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
  text: string;
  state: string;
  signature: string;
}

interface SessionSourceDetails {
  source: { format: string; cueCount: number } | null;
  retryAvailable: boolean;
  detailsVisible: boolean;
}

interface Window {
  subtandemServiceFailureMessage(error: SessionFailureInput | null | undefined): string | null;
  subtandemSessionFailureMessage(error: SessionFailureInput | null | undefined): string | null;
  subtandemResolveSessionPresentation(input: SessionPresentationInput): SessionPresentation | null;
  subtandemResolveSessionSourceDetails(input: SessionPresentationInput): SessionSourceDetails;
}

const sessionStatusLabels: Partial<Record<SessionPresentationStatus, string>> = {
  disabled: "Translation is off",
  waitingForSubtitle: "Select a readable external SRT or ASS subtitle",
  waitingForConfiguration: "No translation service enabled. Enable one to translate.",
  preparing: "Preparing nearby translations…",
  running: "Translations are running",
};

const sessionSourceIssueLabels: Record<string, string> = {
  "not-external": "Select an external SRT or ASS subtitle track.",
  unreadable: "IINA has not exposed readable subtitle data yet; reselect the external subtitle.",
  "unsupported-format": "The selected external subtitle is not readable SRT or ASS text.",
  "unsupported-encoding": "The selected subtitle encoding is not supported.",
  empty: "The selected subtitle contains no readable cues.",
};

const sessionSourcePreparationLabels: Record<SessionSourcePreparationState, string> = {
  preparing: "Preparing the selected embedded subtitle…",
  ready: "",
  unsupportedType: "Subtitle type not supported. Select a text subtitle in IINA.",
  remoteUnsupported: "Embedded subtitles in remote media are not supported.",
  emptyOrUnreadable: "The selected subtitle is empty or unreadable.",
  timedOut: "Subtitle preparation timed out. Playback continues.",
  failed: "Subtitle preparation failed. Playback continues.",
  invalidated: "The subtitle selection changed. Reselect a subtitle in IINA.",
};

function presentation(text: string, state: string): SessionPresentation {
  return { text, state, signature: `${state}\u0000${text}` };
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
    const text = (globalThis as typeof globalThis & Window).subtandemServiceFailureMessage(
      input.providerError,
    );
    return text ? presentation(text, input.status) : null;
  }
  if (input.status === "running" || input.status === "preparing")
    return presentation(sessionStatusLabels[input.status]!, input.status);
  return null;
}

function resolveSessionSourceDetails(input: SessionPresentationInput): SessionSourceDetails {
  if (input.status === "disabled")
    return { source: null, retryAvailable: false, detailsVisible: false };
  return {
    source: input.source ?? null,
    retryAvailable:
      input.sourcePreparation?.state !== "ready" && input.sourcePreparation?.canRetry === true,
    detailsVisible: true,
  };
}

(globalThis as typeof globalThis & Window).subtandemSessionFailureMessage = (
  globalThis as typeof globalThis & Window
).subtandemServiceFailureMessage;
(globalThis as typeof globalThis & Window).subtandemResolveSessionPresentation =
  resolveSessionPresentation;
(globalThis as typeof globalThis & Window).subtandemResolveSessionSourceDetails =
  resolveSessionSourceDetails;
