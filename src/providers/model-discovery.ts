import { providerHttpError, protocolError } from "./errors.js";
import { normalizeProviderEndpoint } from "./profiles.js";
import type { ProviderKind } from "./types.js";
import type { ProviderTransport } from "./transport.js";

export interface ModelDiscoveryRequest {
  jobId: string;
  kind: Exclude<ProviderKind, "fake">;
  endpoint: string;
  apiKey?: string;
  proxyMode?: "system" | "direct";
}

function cleanedUnique(values: unknown[]): string[] {
  const seen = new Set<string>();
  const models: string[] = [];
  for (const value of values) {
    if (typeof value !== "string") continue;
    const model = value.trim();
    if (!model || seen.has(model)) continue;
    seen.add(model);
    models.push(model);
  }
  return models;
}

function parseModelResponse(kind: ModelDiscoveryRequest["kind"], bodyText: string): string[] {
  let parsed: Record<string, unknown>;
  try {
    const value = JSON.parse(bodyText) as unknown;
    if (!value || typeof value !== "object" || Array.isArray(value))
      throw new Error("INVALID_MODEL_RESPONSE");
    parsed = value as Record<string, unknown>;
  } catch {
    throw protocolError(
      kind === "openai"
        ? "OPENAI_MODELS_MALFORMED_RESPONSE"
        : kind === "deepseek"
          ? "DEEPSEEK_MODELS_MALFORMED_RESPONSE"
          : "OLLAMA_TAGS_MALFORMED_RESPONSE",
    );
  }
  if (kind === "openai" || kind === "deepseek") {
    if (!Array.isArray(parsed.data))
      throw protocolError(
        kind === "deepseek"
          ? "DEEPSEEK_MODELS_MALFORMED_RESPONSE"
          : "OPENAI_MODELS_MALFORMED_RESPONSE",
      );
    return cleanedUnique(
      parsed.data.map((item) =>
        item && typeof item === "object" && !Array.isArray(item)
          ? (item as Record<string, unknown>).id
          : undefined,
      ),
    );
  }
  if (!Array.isArray(parsed.models)) throw protocolError("OLLAMA_TAGS_MALFORMED_RESPONSE");
  return cleanedUnique(
    parsed.models.map((item) => {
      if (!item || typeof item !== "object" || Array.isArray(item)) return undefined;
      const model = item as Record<string, unknown>;
      return typeof model.model === "string" && model.model.trim() ? model.model : model.name;
    }),
  );
}

export async function discoverProviderModels(
  request: ModelDiscoveryRequest,
  transport: ProviderTransport,
): Promise<string[]> {
  const endpoint = normalizeProviderEndpoint(request.kind, request.endpoint).replace(/\/+$/, "");
  const response = await transport.request({
    jobId: request.jobId,
    method: "GET",
    url: `${endpoint}${request.kind === "ollama" ? "/api/tags" : "/models"}`,
    headers: request.apiKey?.trim()
      ? { Authorization: `Bearer ${request.apiKey.trim()}` }
      : {},
    proxyMode: request.proxyMode ?? "system",
    timeoutMs: 10_000,
    maxResponseBytes: 1_048_576,
  });
  if (response.statusCode < 200 || response.statusCode >= 300)
    throw providerHttpError(response.statusCode, response.headers);
  return parseModelResponse(request.kind, response.bodyText);
}
