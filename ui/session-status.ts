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
  sourcePreparation?: { state: SessionSourcePreparationState } | null;
}

interface SessionPresentation {
  text: string;
  state: string;
  signature: string;
}

interface Window {
  subtandemSessionFailureMessage(error: SessionFailureInput | null | undefined): string | null;
  subtandemResolveSessionPresentation(input: SessionPresentationInput): SessionPresentation | null;
}

const sessionStatusLabels: Partial<Record<SessionPresentationStatus, string>> = {
  disabled: "Translation is off",
  waitingForSubtitle: "Select a readable external SRT or ASS subtitle",
  waitingForConfiguration: "Enable and test a translation service",
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
  unsupportedType: "This subtitle type is not supported. Select a text subtitle in IINA.",
  remoteUnsupported: "Embedded subtitles in remote media are not supported.",
  emptyOrUnreadable: "The selected subtitle is empty or unreadable.",
  timedOut: "Subtitle preparation timed out. Playback continues.",
  failed: "Subtitle preparation failed. Playback continues.",
  invalidated: "The subtitle selection changed. Reselect a subtitle in IINA.",
};

function sessionFailureMessage(error: SessionFailureInput | null | undefined): string | null {
  if (error?.category === "cancelled") return null;
  if (
    error?.statusCode === 401 ||
    (error?.category === "authentication" && error.statusCode !== 403)
  )
    return "Authentication failed. Check the Profile’s API key.";
  if (error?.statusCode === 403)
    return "Access was denied. Check the Profile’s API key and model access.";
  if (error?.category === "configuration")
    return "The Profile settings were rejected. Check the Endpoint and Model ID.";
  if (error?.category === "network")
    return "Couldn’t reach the translation service. Check your connection and Network route.";
  if (error?.category === "timeout" || error?.statusCode === 408 || error?.statusCode === 504)
    return "The translation service timed out. Try again.";
  if (error?.category === "model") return "The model is unavailable. Check the Profile’s Model ID.";
  if (error?.category === "quota" || error?.statusCode === 402 || error?.statusCode === 429)
    return "The service limit was reached. Check the account quota or try again later.";
  if (error?.category === "refusal")
    return "The translation service refused this request. Try another model or Profile.";
  if (error?.category === "protocol" && error.providerCode !== "UNKNOWN_PROVIDER_ERROR")
    return "The translation service returned an unsupported response. Check the Profile’s service type and model.";
  if (error?.category === "http")
    return "The translation service rejected the request. Check the Profile settings and try again.";
  return "Translation failed. Test the Profile and try again.";
}

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
    const text = sessionFailureMessage(input.providerError);
    return text ? presentation(text, input.status) : null;
  }
  if (input.status === "running" || input.status === "preparing")
    return presentation(sessionStatusLabels[input.status]!, input.status);
  return null;
}

(globalThis as typeof globalThis & Window).subtandemSessionFailureMessage = sessionFailureMessage;
(globalThis as typeof globalThis & Window).subtandemResolveSessionPresentation =
  resolveSessionPresentation;
