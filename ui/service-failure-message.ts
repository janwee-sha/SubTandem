interface ServiceFailureInput {
  category?: string;
  statusCode?: number;
  providerCode?: string;
  retryable?: boolean;
  userAction?: string;
}

interface Window {
  subtandemServiceFailureMessage(error: ServiceFailureInput | null | undefined): string | null;
}

function serviceFailureMessage(error: ServiceFailureInput | null | undefined): string | null {
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

(globalThis as typeof globalThis & Window).subtandemServiceFailureMessage = serviceFailureMessage;
