import { claudeHttpError } from "./errors.js";
import { providerApiUrl } from "./profiles.js";
import type { ProviderAttemptError } from "./types.js";

export type ClaudeResource = "messages" | "models";

const CLAUDE_ERROR_TYPES = new Set([
  "authentication_error",
  "billing_error",
  "invalid_request_error",
  "monthly_spend_limit_reached",
  "not_found_error",
  "overloaded_error",
  "permission_error",
  "rate_limit_error",
  "request_too_large",
  "spend_limit_reached",
]);

export function claudeApiUrl(root: string, resource: ClaudeResource): string {
  return providerApiUrl("claude", root, resource === "messages" ? "translation" : "models");
}

export function claudeRequestHeaders(
  resource: ClaudeResource = "messages",
): Record<string, string> {
  return {
    ...(resource === "messages" ? { "Content-Type": "application/json" } : {}),
    "anthropic-version": "2023-06-01",
  };
}

export function claudeApiError(
  statusCode: number,
  headers: Record<string, string>,
  bodyText: string,
  resource: ClaudeResource,
): ProviderAttemptError {
  let providerCode: string | undefined;
  let providerMessage: string | undefined;
  try {
    const value: unknown = JSON.parse(bodyText);
    if (value && typeof value === "object" && !Array.isArray(value)) {
      const error = (value as Record<string, unknown>).error;
      if (error && typeof error === "object" && !Array.isArray(error)) {
        const type = (error as Record<string, unknown>).type;
        if (typeof type === "string" && CLAUDE_ERROR_TYPES.has(type)) providerCode = type;
        const message = (error as Record<string, unknown>).message;
        if (typeof message === "string") providerMessage = message.slice(0, 2_048);
      }
    }
  } catch {
    providerCode = undefined;
    providerMessage = undefined;
  }
  return claudeHttpError(statusCode, headers, resource, providerCode, providerMessage);
}
