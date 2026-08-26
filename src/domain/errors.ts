import { diagnostic, type SafeDiagnostic } from "./logging.js";
import type { ProviderAttemptError, ProviderErrorCategory } from "../providers/types.js";
import { USER_ACTIONS } from "./status.js";

const PROVIDER_ERROR_CATEGORIES = new Set<ProviderErrorCategory>([
  "network",
  "timeout",
  "http",
  "authentication",
  "configuration",
  "model",
  "quota",
  "refusal",
  "protocol",
  "cancelled",
]);
const SAFE_CODE = /^[A-Za-z0-9_.:-]{1,128}$/;

export class SubTandemError extends Error {
  constructor(
    readonly code: string,
    readonly category: ProviderErrorCategory,
    readonly userAction: string,
    readonly retryable = false,
    readonly statusCode?: number,
  ) {
    super(code);
    this.name = "SubTandemError";
  }

  toDiagnostic(): SafeDiagnostic {
    return diagnostic({
      code: this.code,
      category: this.category,
      userAction: this.userAction,
      statusCode: this.statusCode,
    });
  }
}

export function normalizeProviderError(value: unknown): ProviderAttemptError {
  if (value instanceof SubTandemError) {
    return {
      category: value.category,
      retryable: value.retryable,
      ...(value.statusCode === undefined ? {} : { statusCode: value.statusCode }),
      providerCode: value.code,
      userAction: value.userAction,
    };
  }
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const input = value as Record<string, unknown>;
    if (
      typeof input.category === "string" &&
      PROVIDER_ERROR_CATEGORIES.has(input.category as ProviderErrorCategory) &&
      typeof input.retryable === "boolean" &&
      typeof input.userAction === "string" &&
      USER_ACTIONS.includes(input.userAction as (typeof USER_ACTIONS)[number])
    ) {
      return {
        category: input.category as ProviderErrorCategory,
        retryable: input.retryable,
        ...(typeof input.statusCode === "number" &&
        Number.isInteger(input.statusCode) &&
        input.statusCode >= 100 &&
        input.statusCode <= 599
          ? { statusCode: input.statusCode }
          : {}),
        ...(typeof input.providerCode === "string" && SAFE_CODE.test(input.providerCode)
          ? { providerCode: input.providerCode }
          : {}),
        ...(typeof input.retryAfterMs === "number" &&
        Number.isFinite(input.retryAfterMs) &&
        input.retryAfterMs >= 0
          ? { retryAfterMs: input.retryAfterMs }
          : {}),
        ...(typeof input.providerRequestId === "string" && SAFE_CODE.test(input.providerRequestId)
          ? { providerRequestId: input.providerRequestId }
          : {}),
        userAction: input.userAction,
      };
    }
  }
  return {
    category: "protocol",
    retryable: false,
    providerCode: "UNKNOWN_PROVIDER_ERROR",
    userAction: "CHECK_ENDPOINT",
  };
}
