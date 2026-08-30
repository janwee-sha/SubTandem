import type { ConfiguredProvider } from "./provider.js";
import type {
  ProviderAttemptError,
  TranslationBatchRequest,
  TranslationBatchResult,
  TranslationProgressHandler,
  WireTranslationTarget,
} from "./types.js";
import type { ProviderTransport, ProviderTransportResponse } from "./transport.js";
import { deepSeekHttpError, protocolError } from "./errors.js";
import { normalizeProviderEndpoint } from "./profiles.js";
import { validateStrictIdOutput } from "./validation.js";
import { buildDeepSeekTranslationTask } from "./translation-task.js";
import { runTranslationBatches } from "./translation-batches.js";

export class DeepSeekProvider implements ConfiguredProvider {
  private readonly endpoint: string;
  private readonly activeJobs = new Set<string>();
  private readonly activeRequests = new Set<string>();
  private readonly cancelledRequests = new Set<string>();

  constructor(
    private readonly config: {
      endpoint: string;
      model: string;
      apiKey?: string;
      proxyMode?: "system" | "direct";
    },
    private readonly transport: ProviderTransport,
  ) {
    this.endpoint = normalizeProviderEndpoint("deepseek", config.endpoint);
    if (!config.model.trim()) throw new Error("MODEL_REQUIRED");
  }

  async testConnection(testId: string): Promise<{ model: string }> {
    this.cancelledRequests.delete(testId);
    this.activeRequests.add(testId);
    try {
      const response = await this.send(
        testId,
        [{ id: "probe", text: "hello" }],
        "en",
        "es",
        10_000,
      );
      this.throwIfCancelled(testId);
      this.parseResponse(["probe"], response);
      return { model: this.config.model };
    } finally {
      this.activeRequests.delete(testId);
      this.cancelledRequests.delete(testId);
    }
  }

  async attempt(
    request: TranslationBatchRequest,
    onProgress?: TranslationProgressHandler,
  ): Promise<TranslationBatchResult> {
    this.cancelledRequests.delete(request.requestId);
    this.activeRequests.add(request.requestId);
    try {
      return await runTranslationBatches(
        request,
        async (jobId, items) => {
          const response = await this.send(
            jobId,
            items,
            request.sourceLanguage,
            request.targetLanguage,
            30_000,
          );
          this.throwIfCancelled(request.requestId);
          return this.parseResponse(
            items.map((item) => item.id),
            response,
          );
        },
        () => this.throwIfCancelled(request.requestId),
        onProgress,
      );
    } finally {
      this.activeRequests.delete(request.requestId);
      this.cancelledRequests.delete(request.requestId);
    }
  }

  async cancel(requestId: string): Promise<void> {
    if (this.activeRequests.has(requestId)) this.cancelledRequests.add(requestId);
    const jobs = [...this.activeJobs].filter(
      (jobId) => jobId === requestId || jobId.startsWith(`${requestId}-`),
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

  private async send(
    jobId: string,
    items: WireTranslationTarget[],
    sourceLanguage: string,
    targetLanguage: string,
    timeoutMs: number,
  ): Promise<ProviderTransportResponse> {
    const task = buildDeepSeekTranslationTask({ sourceLanguage, targetLanguage, targets: items });
    this.activeJobs.add(jobId);
    try {
      return await this.transport.request({
        jobId,
        method: "POST",
        url: `${this.endpoint.replace(/\/+$/, "")}/chat/completions`,
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
          temperature: 0,
          thinking: { type: "disabled" },
          response_format: { type: "json_object" },
          messages: [
            { role: "system", content: task.systemMessage },
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

  private parseResponse(
    requestedIds: string[],
    response: ProviderTransportResponse,
  ): TranslationBatchResult {
    if (response.statusCode < 200 || response.statusCode >= 300)
      throw deepSeekHttpError(response.statusCode, response.headers);
    let parsed: Record<string, unknown>;
    try {
      const value: unknown = JSON.parse(response.bodyText);
      if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error();
      parsed = value as Record<string, unknown>;
    } catch {
      throw protocolError("DEEPSEEK_MALFORMED_JSON");
    }
    const choice =
      Array.isArray(parsed.choices) && parsed.choices.length > 0
        ? (parsed.choices[0] as Record<string, unknown> | undefined)
        : undefined;
    if (!choice || typeof choice !== "object" || Array.isArray(choice))
      throw protocolError("DEEPSEEK_MALFORMED_OUTPUT");
    const finishReason = choice?.finish_reason;
    if (finishReason === "content_filter") throw protocolError("DEEPSEEK_REFUSAL", "refusal");
    if (finishReason === "length") throw protocolError("DEEPSEEK_LENGTH");
    if (finishReason !== "stop") throw protocolError("DEEPSEEK_FINISH_REASON");
    const message = choice?.message as Record<string, unknown> | undefined;
    if (typeof message?.refusal === "string" && message.refusal)
      throw protocolError("DEEPSEEK_REFUSAL", "refusal");
    if (typeof message?.content !== "string" || !message.content.trim())
      throw protocolError("DEEPSEEK_EMPTY_OUTPUT");
    let output: unknown;
    try {
      output = JSON.parse(message.content);
    } catch {
      throw protocolError("DEEPSEEK_MALFORMED_OUTPUT");
    }
    let validated: TranslationBatchResult;
    try {
      validated = validateStrictIdOutput(requestedIds, output);
    } catch {
      throw protocolError("DEEPSEEK_MALFORMED_OUTPUT");
    }
    const usage = parsed.usage as Record<string, unknown> | undefined;
    const inputUsage =
      typeof usage?.prompt_tokens === "number" &&
      Number.isFinite(usage.prompt_tokens) &&
      usage.prompt_tokens >= 0
        ? usage.prompt_tokens
        : undefined;
    const outputUsage =
      typeof usage?.completion_tokens === "number" &&
      Number.isFinite(usage.completion_tokens) &&
      usage.completion_tokens >= 0
        ? usage.completion_tokens
        : undefined;
    const providerRequestId = response.headers["x-request-id"];
    return {
      translations: validated.translations,
      ...(inputUsage !== undefined || outputUsage !== undefined
        ? {
            usage: {
              ...(inputUsage === undefined ? {} : { input: inputUsage }),
              ...(outputUsage === undefined ? {} : { output: outputUsage }),
            },
          }
        : {}),
      ...(typeof providerRequestId === "string" &&
      /^[A-Za-z0-9_.:-]{1,128}$/.test(providerRequestId)
        ? { providerRequestId }
        : {}),
    };
  }
}
