import type { ConfiguredProvider } from "./provider.js";
import type {
  ProviderAttemptError,
  TranslationBatchRequest,
  TranslationBatchResult,
  TranslationProgressHandler,
  WireTranslationTarget,
} from "./types.js";
import type { ProviderTransport, ProviderTransportResponse } from "./transport.js";
import { providerHttpError, protocolError } from "./errors.js";
import { normalizeProviderEndpoint } from "./profiles.js";
import { validateIdOutput } from "./validation.js";
import { encodeWireItems } from "./wire-items.js";
import { buildTranslationTask } from "./translation-task.js";

const MAX_ITEMS_PER_CHAT_REQUEST = 2;
type OllamaOutputCapability = "json-schema" | "prompt-json";

export class OllamaProvider implements ConfiguredProvider {
  private readonly endpoint: string;
  private readonly activeJobs = new Set<string>();
  private readonly activeRequests = new Set<string>();
  private readonly cancelledRequests = new Set<string>();
  private outputCapability: OllamaOutputCapability;
  constructor(
    private readonly config: {
      endpoint: string;
      model: string;
      apiKey?: string;
      proxyMode?: "system" | "direct";
    },
    private readonly transport: ProviderTransport,
  ) {
    this.endpoint = normalizeProviderEndpoint("ollama", config.endpoint);
    if (!config.model.trim()) throw new Error("MODEL_REQUIRED");
    const authority = this.endpoint.match(/^https?:\/\/([^/]+)/i)?.[1] ?? "";
    this.outputCapability =
      authority === "ollama.com" || authority.startsWith("ollama.com:")
        ? "prompt-json"
        : "json-schema";
  }

  async probe(): Promise<{ version: string; model: string }> {
    return this.runProbe("probe");
  }

  async testConnection(testId: string): Promise<{ version: string; model: string }> {
    this.cancelledRequests.delete(testId);
    this.activeRequests.add(testId);
    try {
      return await this.runProbe(testId);
    } finally {
      this.activeRequests.delete(testId);
      this.cancelledRequests.delete(testId);
    }
  }

  private async runProbe(scopeId: string): Promise<{ version: string; model: string }> {
    this.throwIfCancelled(scopeId);
    const versionResponse = await this.get(`${scopeId}-version`, "/api/version");
    this.throwIfCancelled(scopeId);
    if (versionResponse.statusCode !== 200)
      throw providerHttpError(versionResponse.statusCode, versionResponse.headers);
    const version = this.json(versionResponse.bodyText).version;
    const tagsResponse = await this.get(`${scopeId}-tags`, "/api/tags");
    this.throwIfCancelled(scopeId);
    if (tagsResponse.statusCode !== 200)
      throw providerHttpError(tagsResponse.statusCode, tagsResponse.headers);
    const models = this.json(tagsResponse.bodyText).models;
    if (
      !Array.isArray(models) ||
      !models.some((model) => {
        if (!model || typeof model !== "object") return false;
        const item = model as Record<string, unknown>;
        const id = typeof item.model === "string" && item.model.trim() ? item.model : item.name;
        return id === this.config.model;
      })
    ) {
      throw protocolError("OLLAMA_MODEL_MISSING", "model");
    }
    await this.validatedChat(
      scopeId,
      `${scopeId}-schema`,
      [{ id: "probe", text: "hello" }],
      "en",
      "es",
      15_000,
    );
    this.throwIfCancelled(scopeId);
    return { version: typeof version === "string" ? version : "unknown", model: this.config.model };
  }

  async attempt(
    request: TranslationBatchRequest,
    onProgress?: TranslationProgressHandler,
  ): Promise<TranslationBatchResult> {
    this.cancelledRequests.delete(request.requestId);
    this.activeRequests.add(request.requestId);
    try {
      const wire = encodeWireItems(request.items);
      const combined: TranslationBatchResult = { translations: [] };
      for (let offset = 0; offset < wire.items.length; offset += MAX_ITEMS_PER_CHAT_REQUEST) {
        this.throwIfCancelled(request.requestId);
        const items = wire.items.slice(offset, offset + MAX_ITEMS_PER_CHAT_REQUEST);
        const part = Math.floor(offset / MAX_ITEMS_PER_CHAT_REQUEST) + 1;
        const parsed = await this.validatedChat(
          request.requestId,
          `${request.requestId}-part-${part}`,
          items,
          request.sourceLanguage,
          request.targetLanguage,
          60_000,
        );
        this.throwIfCancelled(request.requestId);
        const progress = wire.restore(parsed);
        if (progress.translations.length > 0) onProgress?.(progress);
        combined.translations.push(...parsed.translations);
        for (const key of ["input", "output", "characters"] as const) {
          const value = parsed.usage?.[key];
          if (value === undefined) continue;
          combined.usage ??= {};
          combined.usage[key] = (combined.usage[key] ?? 0) + value;
        }
      }
      this.throwIfCancelled(request.requestId);
      return wire.restore(combined);
    } finally {
      this.activeRequests.delete(request.requestId);
      this.cancelledRequests.delete(request.requestId);
    }
  }

  async cancel(requestId: string): Promise<void> {
    if (this.activeRequests.has(requestId)) this.cancelledRequests.add(requestId);
    const jobs = [...this.activeJobs].filter(
      (jobId) =>
        jobId === requestId || jobId.startsWith(`${requestId}-`),
    );
    await Promise.allSettled(jobs.map((jobId) => this.transport.cancel?.(jobId)));
  }

  private throwIfCancelled(requestId: string): void {
    if (!this.cancelledRequests.has(requestId)) return;
    throw {
      category: "cancelled",
      retryable: false,
      providerCode: "REQUEST_CANCELLED",
      userAction: "RETRY",
    } satisfies ProviderAttemptError;
  }

  private async get(jobId: string, path: string): Promise<ProviderTransportResponse> {
    this.activeJobs.add(jobId);
    try {
      return await this.transport.request({
        jobId,
        method: "GET",
        url: `${this.endpoint}${path}`,
        headers: this.config.apiKey?.trim()
          ? { Authorization: `Bearer ${this.config.apiKey.trim()}` }
          : {},
        proxyMode: this.config.proxyMode ?? "system",
        timeoutMs: 10_000,
        maxResponseBytes: 1_048_576,
      });
    } finally {
      this.activeJobs.delete(jobId);
    }
  }

  private async chat(
    jobId: string,
    items: WireTranslationTarget[],
    sourceLanguage: string,
    targetLanguage: string,
    timeoutMs: number,
    capability = this.outputCapability,
  ): Promise<ProviderTransportResponse> {
    const task = buildTranslationTask({ sourceLanguage, targetLanguage, targets: items });
    this.activeJobs.add(jobId);
    try {
      return await this.transport.request({
        jobId,
        method: "POST",
        url: `${this.endpoint}/api/chat`,
        headers: {
          "Content-Type": "application/json",
          ...(this.config.apiKey?.trim()
            ? { Authorization: `Bearer ${this.config.apiKey.trim()}` }
            : {}),
        },
        proxyMode: this.config.proxyMode ?? "system",
        body: {
          model: this.config.model,
          stream: false,
          ...(capability === "json-schema" ? { format: task.outputSchema } : {}),
          options: { temperature: 0 },
          messages: [
            {
              role: "system",
              content:
                capability === "prompt-json"
                  ? `${task.systemMessage} The response must validate against this exact JSON Schema: ${JSON.stringify(task.outputSchema)}`
                  : task.systemMessage,
            },
            { role: "user", content: task.userMessage },
          ],
        },
        timeoutMs,
        maxResponseBytes: 1_048_576,
      });
    } finally {
      this.activeJobs.delete(jobId);
    }
  }

  private async validatedChat(
    scopeId: string,
    jobId: string,
    items: WireTranslationTarget[],
    sourceLanguage: string,
    targetLanguage: string,
    timeoutMs: number,
  ): Promise<TranslationBatchResult> {
    const requestedIds = items.map((item) => item.id);
    const initialCapability = this.outputCapability;
    let response = await this.chat(
      jobId,
      items,
      sourceLanguage,
      targetLanguage,
      timeoutMs,
      initialCapability,
    );
    this.throwIfCancelled(scopeId);
    if (response.statusCode < 200 || response.statusCode >= 300) {
      if (
        initialCapability !== "json-schema" ||
        !this.isStructuredOutputIncompatibility(response)
      )
        throw providerHttpError(response.statusCode, response.headers);
      this.outputCapability = "prompt-json";
      response = await this.chat(
        this.fallbackJobId(jobId),
        items,
        sourceLanguage,
        targetLanguage,
        timeoutMs,
        "prompt-json",
      );
      this.throwIfCancelled(scopeId);
      if (response.statusCode < 200 || response.statusCode >= 300)
        throw providerHttpError(response.statusCode, response.headers);
      return this.parse(requestedIds, response);
    }
    try {
      return this.parse(requestedIds, response);
    } catch (error) {
      if (initialCapability !== "json-schema") throw error;
      this.outputCapability = "prompt-json";
      const fallback = await this.chat(
        this.fallbackJobId(jobId),
        items,
        sourceLanguage,
        targetLanguage,
        timeoutMs,
        "prompt-json",
      );
      this.throwIfCancelled(scopeId);
      if (fallback.statusCode < 200 || fallback.statusCode >= 300)
        throw providerHttpError(fallback.statusCode, fallback.headers);
      return this.parse(requestedIds, fallback);
    }
  }

  private fallbackJobId(jobId: string): string {
    return jobId.endsWith("-schema") ? `${jobId.slice(0, -7)}-prompt` : `${jobId}-prompt`;
  }

  private isStructuredOutputIncompatibility(response: ProviderTransportResponse): boolean {
    if (response.statusCode !== 400 && response.statusCode !== 422) return false;
    return /(unsupported|not supported|format|json.?schema|structured output)/i.test(
      response.bodyText.slice(0, 16_384),
    );
  }

  private json(text: string): Record<string, unknown> {
    try {
      const parsed: unknown = JSON.parse(text);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error();
      return parsed as Record<string, unknown>;
    } catch {
      throw protocolError("OLLAMA_MALFORMED_JSON");
    }
  }

  private parse(
    requestedIds: string[],
    response: ProviderTransportResponse,
  ): TranslationBatchResult {
    const parsed = this.json(response.bodyText);
    const message = parsed.message as Record<string, unknown> | undefined;
    if (typeof message?.content !== "string") throw protocolError("OLLAMA_MALFORMED_OUTPUT");
    const content = message.content.trim();
    const fenced = content.match(/^```(?:json)?\s*\n?([\s\S]*?)\n?```$/i);
    let validated: TranslationBatchResult;
    try {
      validated = validateIdOutput(requestedIds, fenced ? fenced[1]!.trim() : content);
    } catch {
      throw protocolError("OLLAMA_MALFORMED_OUTPUT");
    }
    return {
      translations: validated.translations,
      usage: {
        ...(typeof parsed.prompt_eval_count === "number"
          ? { input: parsed.prompt_eval_count }
          : {}),
        ...(typeof parsed.eval_count === "number" ? { output: parsed.eval_count } : {}),
      },
    };
  }
}
