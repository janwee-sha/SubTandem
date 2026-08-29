import type { ConfiguredProvider } from "./provider.js";
import type {
  ProviderAttemptError,
  TranslationBatchRequest,
  TranslationBatchResult,
  TranslationProgressHandler,
  WireTranslationTarget,
} from "./types.js";
import type { ProviderTransport, ProviderTransportResponse } from "./transport.js";
import { claudeApiError, claudeApiUrl, claudeRequestHeaders } from "./claude-api.js";
import { protocolError } from "./errors.js";
import { buildClaudeTranslationTask } from "./translation-task.js";
import { runTranslationBatches } from "./translation-batches.js";
import { validateStrictIdOutput } from "./validation.js";

export class ClaudeProvider implements ConfiguredProvider {
  private readonly messagesUrl: string;
  private readonly apiKey: string;
  private readonly activeJobs = new Set<string>();
  private readonly activeRequests = new Set<string>();
  private readonly cancelledRequests = new Set<string>();

  constructor(
    private readonly config: {
      endpoint: string;
      model: string;
      apiKey: string;
      proxyMode?: "system" | "direct";
    },
    private readonly transport: ProviderTransport,
  ) {
    this.messagesUrl = claudeApiUrl(config.endpoint, "messages");
    this.apiKey = config.apiKey.trim();
    if (!config.model.trim()) throw new Error("MODEL_REQUIRED");
    if (!this.apiKey) throw new Error("CREDENTIAL_REQUIRED");
  }

  async testConnection(testId: string): Promise<{ model: string }> {
    this.cancelledRequests.delete(testId);
    this.activeRequests.add(testId);
    try {
      const response = await this.send(
        testId,
        [{ id: "c1", text: "hello" }],
        "en",
        "es",
        10_000,
      );
      this.throwIfCancelled(testId);
      this.parseResponse(["c1"], response);
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
    const task = buildClaudeTranslationTask({ sourceLanguage, targetLanguage, targets: items });
    this.activeJobs.add(jobId);
    try {
      return await this.transport.request({
        jobId,
        method: "POST",
        url: this.messagesUrl,
        headers: claudeRequestHeaders(this.apiKey),
        proxyMode: this.config.proxyMode ?? "system",
        body: {
          model: this.config.model,
          max_tokens: 8192,
          stream: false,
          system: task.systemMessage,
          messages: [{ role: "user", content: task.userMessage }],
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
      throw claudeApiError(response.statusCode, response.headers, response.bodyText, "messages");
    let parsed: Record<string, unknown>;
    try {
      const value: unknown = JSON.parse(response.bodyText);
      if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error();
      parsed = value as Record<string, unknown>;
    } catch {
      throw protocolError("CLAUDE_MALFORMED_JSON");
    }
    const content = parsed.content;
    const stopDetails = parsed.stop_details;
    const refusal =
      parsed.stop_reason === "refusal" ||
      (stopDetails &&
        typeof stopDetails === "object" &&
        !Array.isArray(stopDetails) &&
        (stopDetails as Record<string, unknown>).type === "refusal") ||
      (Array.isArray(content) &&
        content.some(
          (block) =>
            block &&
            typeof block === "object" &&
            !Array.isArray(block) &&
            (block as Record<string, unknown>).type === "refusal",
        ));
    if (refusal) throw protocolError("CLAUDE_REFUSAL", "refusal");
    if (
      parsed.type !== "message" ||
      parsed.role !== "assistant" ||
      parsed.stop_reason !== "end_turn" ||
      !Array.isArray(content)
    )
      throw protocolError("CLAUDE_MALFORMED_OUTPUT");
    const textBlocks = content.flatMap((block) => {
      if (!block || typeof block !== "object" || Array.isArray(block)) return [];
      const record = block as Record<string, unknown>;
      return record.type === "text" && typeof record.text === "string" ? [record.text] : [];
    });
    const candidate = textBlocks.join("");
    if (textBlocks.length === 0 || !candidate.trim()) throw protocolError("CLAUDE_EMPTY_OUTPUT");
    let output: unknown;
    try {
      output = JSON.parse(candidate);
    } catch {
      throw protocolError("CLAUDE_MALFORMED_OUTPUT");
    }
    let validated: TranslationBatchResult;
    try {
      validated = validateStrictIdOutput(requestedIds, output);
    } catch {
      throw protocolError("CLAUDE_MALFORMED_OUTPUT");
    }
    const usage = parsed.usage;
    const usageRecord =
      usage && typeof usage === "object" && !Array.isArray(usage)
        ? (usage as Record<string, unknown>)
        : undefined;
    const inputUsage = this.safeUsage(usageRecord?.input_tokens);
    const outputUsage = this.safeUsage(usageRecord?.output_tokens);
    const providerRequestId = response.headers["request-id"];
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

  private safeUsage(value: unknown): number | undefined {
    return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;
  }
}
