interface ProviderTestStatus {
  ok?: boolean;
  category?: string;
  statusCode?: number;
  code?: string;
  userAction?: string;
  providerKind?: "openai" | "claude" | "deepseek" | "ollama";
}

interface Window {
  subtandemServiceFailureFeedback(result: ProviderTestStatus): LocalizedFeedback | null;
  subtandemProviderTestStatusFeedback(result: ProviderTestStatus): LocalizedFeedback | null;
  subtandemModelCatalogStatusFeedback(result: ModelCatalogStatus): LocalizedFeedback | null;
}

interface ModelCatalogStatus {
  ok?: boolean;
  count?: number;
  category?: string;
  statusCode?: number;
  credentialSource?: "saved" | "entered" | "none";
}

function providerTestStatusFeedback(result: ProviderTestStatus): LocalizedFeedback | null {
  if (result.ok)
    return (globalThis as typeof globalThis & Window).subtandemLocalization.message(
      "sidebar.testPassed",
    );
  if (result.code === "TEST_INVALIDATED")
    return (globalThis as typeof globalThis & Window).subtandemLocalization.message(
      "sidebar.thisTestIsNoLongerCurrentReview",
    );
  switch (result.userAction) {
    case "RESTART_IINA":
      return (globalThis as typeof globalThis & Window).subtandemLocalization.message(
        "sidebar.theSecureTransportHelperIsUnavailableRestart",
      );
    case "CHECK_INSTALLATION":
      return (globalThis as typeof globalThis & Window).subtandemLocalization.message(
        "sidebar.theBundledTransportHelperCouldNotBe",
      );
  }
  return (
    (globalThis as typeof globalThis & Window).subtandemServiceFailureFeedback({
      ...result,
      ...(result.code === undefined ? {} : { providerCode: result.code }),
    }) ?? null
  );
}

(globalThis as typeof globalThis & Window).subtandemProviderTestStatusFeedback =
  providerTestStatusFeedback;

function modelCatalogStatusFeedback(result: ModelCatalogStatus): LocalizedFeedback | null {
  if (result.ok) {
    const count = typeof result.count === "number" ? result.count : 0;
    if (count === 0)
      return (globalThis as typeof globalThis & Window).subtandemLocalization.message(
        "sidebar.noModelsWereReturnedCustomModelID",
      );
    return (globalThis as typeof globalThis & Window).subtandemLocalization.message(
      "models.available",
      { count },
    );
  }
  if (result.category === "authentication") {
    if (result.credentialSource === "entered")
      return (globalThis as typeof globalThis & Window).subtandemLocalization.message(
        "sidebar.modelRefreshFailedCheckTheEnteredAPI",
      );
    if (result.credentialSource === "saved")
      return (globalThis as typeof globalThis & Window).subtandemLocalization.message(
        "sidebar.modelRefreshFailedCheckTheSavedAPI",
      );
    return (globalThis as typeof globalThis & Window).subtandemLocalization.message(
      "sidebar.modelRefreshFailedEnterAnAPIKey",
    );
  }
  if (result.category === "timeout")
    return (globalThis as typeof globalThis & Window).subtandemLocalization.message(
      "sidebar.modelRefreshTimedOutTryAgain",
    );
  if (result.category === "protocol")
    return (globalThis as typeof globalThis & Window).subtandemLocalization.message(
      "sidebar.thisServiceDidNotReturnACompatible",
    );
  if (typeof result.statusCode === "number")
    return (globalThis as typeof globalThis & Window).subtandemLocalization.message(
      "models.httpFailure",
      { statusCode: result.statusCode },
    );
  return (globalThis as typeof globalThis & Window).subtandemLocalization.message(
    "sidebar.modelRefreshFailedCheckTheAPIRoot",
  );
}

(globalThis as typeof globalThis & Window).subtandemModelCatalogStatusFeedback =
  modelCatalogStatusFeedback;
