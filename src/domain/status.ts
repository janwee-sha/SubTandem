export const SESSION_STATUSES = [
  "disabled",
  "waitingForSubtitle",
  "detectingLanguage",
  "languageUnrecognized",
  "languageUnsupported",
  "noTranslationNeeded",
  "waitingForConfiguration",
  "preparing",
  "running",
  "partialFailure",
  "serviceUnavailable",
] as const;

export type SessionStatus = (typeof SESSION_STATUSES)[number];

export const SOURCE_PREPARATION_STATES = [
  "preparing",
  "ready",
  "unsupportedType",
  "remoteUnsupported",
  "emptyOrUnreadable",
  "timedOut",
  "failed",
  "invalidated",
] as const;

export type SourcePreparationState = (typeof SOURCE_PREPARATION_STATES)[number];

export const USER_ACTIONS = [
  "NONE",
  "CHECK_NETWORK",
  "CHECK_ENDPOINT",
  "CHECK_CREDENTIALS",
  "CHECK_MODEL",
  "CHECK_QUOTA",
  "SELECT_PROFILE",
  "RESTART_IINA",
  "CHECK_INSTALLATION",
] as const;

export type UserActionCode = (typeof USER_ACTIONS)[number];
