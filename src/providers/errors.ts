import { parseRetryAfter } from "../app/retry-policy.js";
import type { ProviderAttemptError } from "./types.js";

export function providerHttpError(
  statusCode: number,
  headers: Record<string, string>,
  providerCode?: string,
): ProviderAttemptError {
  const code = providerCode?.toLowerCase();
  if (statusCode === 401 || statusCode === 403 || (code && /(auth|api.?key|credential)/.test(code)))
    return {
      category: "authentication",
      retryable: false,
      statusCode,
      ...(providerCode ? { providerCode } : {}),
      userAction: "CHECK_CREDENTIALS",
    };
  if (code && /(model|deployment)/.test(code))
    return {
      category: "model",
      retryable: false,
      statusCode,
      providerCode: providerCode!,
      userAction: "CHECK_MODEL",
    };
  if (code && /(quota|billing|spend)/.test(code))
    return {
      category: "quota",
      retryable: false,
      statusCode,
      providerCode: providerCode!,
      userAction: "CHECK_QUOTA",
    };
  const retryable = [408, 429, 500, 502, 503].includes(statusCode);
  const retryAfterMs = parseRetryAfter(headers["retry-after"]);
  return {
    category: "http",
    retryable,
    statusCode,
    ...(providerCode ? { providerCode } : {}),
    ...(retryAfterMs === undefined ? {} : { retryAfterMs }),
    ...(headers["x-request-id"] ? { providerRequestId: headers["x-request-id"] } : {}),
    userAction: retryable ? "CHECK_NETWORK" : "CHECK_ENDPOINT",
  };
}

export function protocolError(
  code: string,
  category: ProviderAttemptError["category"] = "protocol",
): ProviderAttemptError {
  return {
    category,
    retryable: false,
    providerCode: code,
    userAction: category === "model" ? "CHECK_MODEL" : "CHECK_ENDPOINT",
  };
}
