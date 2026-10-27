interface ServiceFailureInput {
  category?: string;
  statusCode?: number;
  providerCode?: string;
  retryable?: boolean;
  userAction?: string;
}

interface Window {
  subtandemServiceFailureFeedback(
    error: ServiceFailureInput | null | undefined,
  ): LocalizedFeedback | null;
}

function serviceFailureFeedback(
  error: ServiceFailureInput | null | undefined,
): LocalizedFeedback | null {
  if (error?.category === "cancelled") return null;
  if (
    error?.statusCode === 401 ||
    (error?.category === "authentication" && error.statusCode !== 403)
  )
    return (globalThis as typeof globalThis & Window).subtandemLocalization.message(
      "sidebar.authenticationFailedCheckTheProfilesAPIKey",
    );
  if (error?.statusCode === 403)
    return (globalThis as typeof globalThis & Window).subtandemLocalization.message(
      "sidebar.accessWasDeniedCheckTheProfilesAPI",
    );
  if (error?.category === "configuration")
    return (globalThis as typeof globalThis & Window).subtandemLocalization.message(
      "sidebar.theProfileSettingsWereRejectedCheckThe",
    );
  if (error?.category === "network")
    return (globalThis as typeof globalThis & Window).subtandemLocalization.message(
      "sidebar.couldntReachTheTranslationServiceCheckYour",
    );
  if (error?.category === "timeout" || error?.statusCode === 408 || error?.statusCode === 504)
    return (globalThis as typeof globalThis & Window).subtandemLocalization.message(
      "sidebar.theTranslationServiceTimedOutTryAgain",
    );
  if (error?.category === "model")
    return (globalThis as typeof globalThis & Window).subtandemLocalization.message(
      "sidebar.theModelIsUnavailableCheckTheProfiles",
    );
  if (error?.category === "quota" || error?.statusCode === 402 || error?.statusCode === 429)
    return (globalThis as typeof globalThis & Window).subtandemLocalization.message(
      "sidebar.theServiceLimitWasReachedCheckThe",
    );
  if (error?.category === "refusal")
    return (globalThis as typeof globalThis & Window).subtandemLocalization.message(
      "sidebar.theTranslationServiceRefusedThisRequestTry",
    );
  if (error?.category === "protocol" && error.providerCode !== "UNKNOWN_PROVIDER_ERROR")
    return (globalThis as typeof globalThis & Window).subtandemLocalization.message(
      "sidebar.theTranslationServiceReturnedAnUnsupportedResponse",
    );
  if (error?.category === "http")
    return (globalThis as typeof globalThis & Window).subtandemLocalization.message(
      "sidebar.theTranslationServiceRejectedTheRequestCheck",
    );
  return (globalThis as typeof globalThis & Window).subtandemLocalization.message(
    "sidebar.translationFailedTestTheProfileAndTry",
  );
}

(globalThis as typeof globalThis & Window).subtandemServiceFailureFeedback = serviceFailureFeedback;
