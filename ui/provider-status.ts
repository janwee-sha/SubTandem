interface ProviderTestStatus {
  ok?: boolean;
  category?: string;
  statusCode?: number;
  code?: string;
  userAction?: string;
  providerKind?: "openai" | "claude" | "deepseek" | "ollama";
}

interface Window {
  subtandemServiceFailureMessage(result: ProviderTestStatus): string | null;
  subtandemProviderTestStatusMessage(result: ProviderTestStatus): string;
  subtandemModelCatalogStatusMessage(result: ModelCatalogStatus): string;
}

interface ModelCatalogStatus {
  ok?: boolean;
  count?: number;
  category?: string;
  statusCode?: number;
  credentialSource?: "saved" | "entered" | "none";
}

function providerTestStatusMessage(result: ProviderTestStatus): string {
  if (result.ok) return "Test passed";
  if (result.code === "TEST_INVALIDATED")
    return "This test is no longer current. Review the Profile and test again.";
  switch (result.userAction) {
    case "RESTART_IINA":
      return "The secure transport helper is unavailable. Restart IINA and test again.";
    case "CHECK_INSTALLATION":
      return "The bundled transport helper could not be found. Re-link or reinstall the SubTandem plugin, then restart IINA.";
  }
  return (
    (globalThis as typeof globalThis & Window).subtandemServiceFailureMessage({
      ...result,
      ...(result.code === undefined ? {} : { providerCode: result.code }),
    }) ?? ""
  );
}

(globalThis as typeof globalThis & Window).subtandemProviderTestStatusMessage =
  providerTestStatusMessage;

function modelCatalogStatusMessage(result: ModelCatalogStatus): string {
  if (result.ok) {
    const count = typeof result.count === "number" ? result.count : 0;
    if (count === 0) return "No models were returned. Custom model ID remains available.";
    return `${count} ${count === 1 ? "model" : "models"} available.`;
  }
  if (result.category === "authentication") {
    if (result.credentialSource === "entered")
      return "Model refresh failed. Check the entered API key.";
    if (result.credentialSource === "saved")
      return "Model refresh failed. Check the saved API key.";
    return "Model refresh failed. Enter an API key and refresh again.";
  }
  if (result.category === "timeout") return "Model refresh timed out. Try again.";
  if (result.category === "protocol")
    return "This service did not return a compatible model catalog. Enter an exact Custom model ID.";
  if (typeof result.statusCode === "number")
    return `Model refresh failed with HTTP ${result.statusCode}. Check the endpoint.`;
  return "Model refresh failed. Check the endpoint and network route.";
}

(globalThis as typeof globalThis & Window).subtandemModelCatalogStatusMessage =
  modelCatalogStatusMessage;
