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
import { buildTranslationTask } from "./translation-task.js";
import { runChatCompletionBatches } from "./chat-completions.js";

type Capability = "strict-json-schema" | "json-object" | "prompt-json";

export class OpenAICompatibleProvider implements ConfiguredProvider {
  private readonly endpoint: string;
  private capability: Capability | undefined;
  private readonly activeJobs = new Set<string>();
  private readonly activeRequests = new Set<string>();
  private readonly cancelledRequests = new Set<string>();

  constructor(
    private readonly config: {
      endpoint: string;
      model: string;
      apiKey?: string;
      capability?: Capability;
      proxyMode?: "system" | "direct";
      sessionId: string;
    },
    private readonly transport: ProviderTransport,
  ) {
    this.endpoint = normalizeProviderEndpoint("openai", config.endpoint);
    if (!config.model.trim()) throw new Error("MODEL_REQUIRED");
    this.capability = config.capability;
  }

  async probe(): Promise<Capability> {
    if (this.capability) return this.capability;
    return this.runProbe("probe");
  }

  async testConnection(testId: string): Promise<Capability> {
    this.cancelledRequests.delete(testId);
    this.activeRequests.add(testId);
    try {
      const capability = this.capability;
      if (!capability) return await this.runProbe(testId);
      this.throwIfCancelled(testId);
      const response = await this.send(
        `${testId}-probe-${capability}`,
        [{ id: "probe", text: "hello" }],
        "en",
        "es",
        capability,
        10_000,
      );
      this.throwIfCancelled(testId);
      if (response.statusCode < 200 || response.statusCode >= 300) {
        throw providerHttpError(
          response.statusCode,
          response.headers,
          this.providerCode(response.bodyText),
        );
      }
      this.parseResponse(["probe"], response);
      return capability;
    } finally {
      this.activeRequests.delete(testId);
      this.cancelledRequests.delete(testId);
    }
  }

  private async runProbe(scopeId: string): Promise<Capability> {
    for (const capability of ["strict-json-schema", "json-object", "prompt-json"] as const) {
      this.throwIfCancelled(scopeId);
      const response = await this.send(
        `${scopeId}-probe-${capability}`,
        [{ id: "probe", text: "hello" }],
        "en",
        "es",
        capability,
        10_000,
      );
      this.throwIfCancelled(scopeId);
      if (response.statusCode < 200 || response.statusCode >= 300) {
        const providerCode = this.providerCode(response.bodyText);
        if (this.isCapabilityIncompatibility(response, providerCode)) continue;
        throw providerHttpError(response.statusCode, response.headers, providerCode);
      }
      try {
        this.parseResponse(["probe"], response);
        this.capability = capability;
        return capability;
      } catch {
        /* Try the next capability only for a fixed probe. */
      }
    }
    throw protocolError("OPENAI_CAPABILITY_PROBE_FAILED", "configuration");
  }

  async attempt(
    request: TranslationBatchRequest,
    onProgress?: TranslationProgressHandler,
  ): Promise<TranslationBatchResult> {
    this.cancelledRequests.delete(request.requestId);
    this.activeRequests.add(request.requestId);
    try {
      const capability = this.capability ?? (await this.runProbe(request.requestId));
      this.throwIfCancelled(request.requestId);
      return await runChatCompletionBatches(
        request,
        async (jobId, items) => {
          const response = await this.send(
            jobId,
            items,
            request.sourceLanguage,
            request.targetLanguage,
            capability,
            30_000,
          );
          this.throwIfCancelled(request.requestId);
          if (response.statusCode < 200 || response.statusCode >= 300)
            throw providerHttpError(
              response.statusCode,
              response.headers,
              this.providerCode(response.bodyText),
            );
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

  private async send(
    jobId: string,
    items: WireTranslationTarget[],
    sourceLanguage: string,
    targetLanguage: string,
    capability: Capability,
    timeoutMs: number,
  ): Promise<ProviderTransportResponse> {
    const task = buildTranslationTask({ sourceLanguage, targetLanguage, targets: items });
    const apiRoot = this.endpoint.replace(/\/+$/, "");
    const responseFormat =
      capability === "strict-json-schema"
        ? {
            type: "json_schema",
            json_schema: {
              name: "subtitle_translations",
              strict: true,
              schema: task.outputSchema,
            },
          }
        : capability === "json-object"
          ? { type: "json_object" }
          : undefined;
    this.activeJobs.add(jobId);
    try {
      return await this.transport.request({
        jobId,
        method: "POST",
        url: `${apiRoot}/chat/completions`,
        headers: {
          "Content-Type": "application/json",
          ...(this.config.apiKey ? { Authorization: `Bearer ${this.config.apiKey}` } : {}),
          "X-Session-Id": this.config.sessionId,
        },
        proxyMode: this.config.proxyMode ?? "system",
        body: {
          model: this.config.model,
          stream: false,
          temperature: 0,
          ...(responseFormat ? { response_format: responseFormat } : {}),
          messages: [
            {
              role: "system",
              content: task.systemMessage,
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

  private providerCode(bodyText: string): string | undefined {
    try {
      const parsed = JSON.parse(bodyText) as Record<string, unknown>;
      const error = parsed.error as Record<string, unknown> | undefined;
      const code = error?.code ?? error?.type;
      return typeof code === "string" && /^[A-Za-z0-9_.:-]{1,128}$/.test(code)
        ? code
        : undefined;
    } catch {
      return undefined;
    }
  }

  private isCapabilityIncompatibility(
    response: ProviderTransportResponse,
    providerCode?: string,
  ): boolean {
    if (response.statusCode !== 400 && response.statusCode !== 422) return false;
    if (providerCode && /(auth|api.?key|credential|model|deployment|quota|billing|spend)/i.test(providerCode))
      return false;
    return /(unsupported|not supported|response[_ -]?format|json[_ -]?schema|structured output)/i.test(
      response.bodyText.slice(0, 16_384),
    );
  }

  private parseResponse(
    requestedIds: string[],
    response: ProviderTransportResponse,
  ): TranslationBatchResult {
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(response.bodyText) as Record<string, unknown>;
    } catch {
      throw protocolError("OPENAI_MALFORMED_JSON");
    }
    const choice = Array.isArray(parsed.choices)
      ? (parsed.choices[0] as Record<string, unknown> | undefined)
      : undefined;
    const finishReason = choice?.finish_reason;
    if (finishReason === "content_filter" || finishReason === "length")
      throw protocolError(`OPENAI_${String(finishReason).toUpperCase()}`, "refusal");
    const message = choice?.message as Record<string, unknown> | undefined;
    if (typeof message?.refusal === "string" && message.refusal)
      throw protocolError("OPENAI_REFUSAL", "refusal");
    if (typeof message?.content !== "string") throw protocolError("OPENAI_MALFORMED_OUTPUT");
    let output: Record<string, unknown>;
    try {
      output = JSON.parse(message.content) as Record<string, unknown>;
    } catch {
      throw protocolError("OPENAI_MALFORMED_OUTPUT");
    }
    const usage = parsed.usage as Record<string, unknown> | undefined;
    const validated = validateIdOutput(requestedIds, {
      ...output,
      usage: {
        ...(typeof usage?.prompt_tokens === "number" ? { input: usage.prompt_tokens } : {}),
        ...(typeof usage?.completion_tokens === "number"
          ? { output: usage.completion_tokens }
          : {}),
      },
    });
    return {
      translations: validated.translations,
      ...(validated.usage ? { usage: validated.usage } : {}),
      ...(response.headers["x-request-id"]
        ? { providerRequestId: response.headers["x-request-id"] }
        : {}),
    };
  }
}
