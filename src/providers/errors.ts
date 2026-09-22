import { parseRetryAfter } from "../app/retry-policy.js";
import type { ProviderAttemptError } from "./types.js";

interface ProviderResponseError {
  code?: string;
  message?: string;
}

const SAFE_PROVIDER_CODE = /^[A-Za-z0-9_.:-]{1,128}$/;

function providerResponseError(bodyText: string): ProviderResponseError {
  try {
    const parsed: unknown = JSON.parse(bodyText);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const record = parsed as Record<string, unknown>;
    if (typeof record.error === "string") return { message: record.error.slice(0, 2_048) };
    if (record.error && typeof record.error === "object" && !Array.isArray(record.error)) {
      const error = record.error as Record<string, unknown>;
      const code = error.code ?? error.type;
      return {
        ...(typeof code === "string" && SAFE_PROVIDER_CODE.test(code) ? { code } : {}),
        ...(typeof error.message === "string" ? { message: error.message.slice(0, 2_048) } : {}),
      };
    }
    return typeof record.message === "string" ? { message: record.message.slice(0, 2_048) } : {};
  } catch {
    return {};
  }
}

function unavailableModelSignal(code?: string, message?: string): boolean {
  if (
    code &&
    (/(?:model|deployment).*(?:not.?found|not.?exist|missing|unavailable|unsupported|invalid)/i.test(
      code,
    ) ||
      /(?:unknown|invalid|unsupported|unavailable|missing).*(?:model|deployment)/i.test(code))
  )
    return true;
  if (!message) return false;
  return (
    /(?:unknown|invalid|unsupported|unavailable)\s+(?:model|deployment)/i.test(message) ||
    /(?:model|deployment).{0,160}(?:does not exist|do not exist|not exist|not found|is unavailable|is unsupported|is not supported|is invalid)/i.test(
      message,
    )
  );
}

function unavailableModelError(statusCode?: number): ProviderAttemptError {
  return {
    category: "model",
    retryable: false,
    ...(statusCode === undefined ? {} : { statusCode }),
    userAction: "CHECK_MODEL",
  };
}

export function isUnavailableModelResponse(bodyText: string): boolean {
  const error = providerResponseError(bodyText);
  return unavailableModelSignal(error.code, error.message);
}

export function providerHttpErrorFromBody(
  statusCode: number,
  headers: Record<string, string>,
  bodyText: string,
): ProviderAttemptError {
  const error = providerResponseError(bodyText);
  if (statusCode !== 401 && statusCode !== 403 && unavailableModelSignal(error.code, error.message))
    return unavailableModelError(statusCode);
  return providerHttpError(statusCode, headers, error.code);
}

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

export function deepSeekHttpError(
  statusCode: number,
  headers: Record<string, string>,
  bodyText = "",
): ProviderAttemptError {
  const providerRequestId = headers["x-request-id"];
  const safeRequestId =
    typeof providerRequestId === "string" && /^[A-Za-z0-9_.:-]{1,128}$/.test(providerRequestId)
      ? providerRequestId
      : undefined;
  const retryAfterMs = parseRetryAfter(headers["retry-after"]);
  if (statusCode === 401 || statusCode === 403)
    return {
      category: "authentication",
      retryable: false,
      statusCode,
      providerCode: `DEEPSEEK_HTTP_${statusCode}`,
      userAction: "CHECK_CREDENTIALS",
    };
  if (isUnavailableModelResponse(bodyText)) return unavailableModelError(statusCode);
  if (statusCode === 402)
    return {
      category: "quota",
      retryable: false,
      statusCode,
      providerCode: "DEEPSEEK_HTTP_402",
      userAction: "CHECK_QUOTA",
    };
  if (statusCode === 400 || statusCode === 422)
    return {
      category: "configuration",
      retryable: false,
      statusCode,
      providerCode: `DEEPSEEK_HTTP_${statusCode}`,
      userAction: "CHECK_ENDPOINT",
    };
  const retryable = [408, 429, 500, 502, 503].includes(statusCode);
  return {
    category: "http",
    retryable,
    statusCode,
    providerCode: `DEEPSEEK_HTTP_${statusCode}`,
    ...(retryAfterMs === undefined ? {} : { retryAfterMs }),
    ...(safeRequestId ? { providerRequestId: safeRequestId } : {}),
    userAction: retryable ? "CHECK_NETWORK" : "CHECK_ENDPOINT",
  };
}

const CLAUDE_QUOTA_CODES = new Set([
  "billing_error",
  "monthly_spend_limit_reached",
  "spend_limit_reached",
]);

export function claudeHttpError(
  statusCode: number,
  headers: Record<string, string>,
  resource: "messages" | "models",
  providerCode?: string,
  providerMessage?: string,
): ProviderAttemptError {
  const prefix = `CLAUDE_${resource.toUpperCase()}_HTTP_${statusCode}`;
  const retryAfterMs = parseRetryAfter(headers["retry-after"]);
  const safeRequestId = /^[A-Za-z0-9_.:-]{1,128}$/.test(headers["request-id"] ?? "")
    ? headers["request-id"]
    : undefined;
  if (statusCode === 401 || statusCode === 403)
    return {
      category: "authentication",
      retryable: false,
      statusCode,
      providerCode: prefix,
      userAction: "CHECK_CREDENTIALS",
    };
  if (statusCode === 402 || (statusCode === 429 && CLAUDE_QUOTA_CODES.has(providerCode ?? "")))
    return {
      category: "quota",
      retryable: false,
      statusCode,
      providerCode: prefix,
      userAction: "CHECK_QUOTA",
    };
  if (
    resource === "messages" &&
    (statusCode === 404 || unavailableModelSignal(providerCode, providerMessage))
  )
    return unavailableModelError(statusCode);
  if ([400, 404, 409, 413, 422].includes(statusCode))
    return {
      category: "configuration",
      retryable: false,
      statusCode,
      providerCode: prefix,
      userAction: "CHECK_ENDPOINT",
    };
  const retryable = [408, 429, 500, 502, 503, 504, 529].includes(statusCode);
  return {
    category: statusCode === 504 ? "timeout" : "http",
    retryable,
    statusCode,
    providerCode: prefix,
    ...(retryAfterMs === undefined ? {} : { retryAfterMs }),
    ...(safeRequestId ? { providerRequestId: safeRequestId } : {}),
    userAction: retryable ? "CHECK_NETWORK" : "CHECK_ENDPOINT",
  };
}
