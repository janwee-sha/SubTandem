import { RequestLifecycle, type RequestOwner } from "./request-lifecycle.js";
import type { ConfiguredProvider } from "./provider.js";
import type {
  ProviderAttemptError,
  TranslationBatchRequest,
  TranslationBatchResult,
  TranslationProgressHandler,
  WireTranslationTarget,
} from "./types.js";
import type { ProviderTransport, ProviderTransportResponse } from "./transport.js";
import { providerHttpErrorFromBody, protocolError } from "./errors.js";
import { normalizeProviderEndpoint } from "./profiles.js";
import { validateIdOutput, validateStrictIdOutput } from "./validation.js";
import { buildTranslationTask } from "./translation-task.js";
import { runTranslationBatches } from "./translation-batches.js";

type Capability = "strict-json-schema" | "json-object" | "prompt-json";

export class OpenAICompatibleProvider implements ConfiguredProvider {
  private readonly endpoint: string;
  private capability: Capability | undefined;
  private readonly requests = new RequestLifecycle<undefined>();
  private probeSequence = 0;

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
    return this.testConnection(`probe-${++this.probeSequence}`);
  }

  async testConnection(testId: string): Promise<Capability> {
    const owner = this.requests.beginRequired({
      senderId: "provider",
      operation: "test",
      requestId: testId,
      context: undefined,
    });
    try {
      const capability = this.capability;
      if (!capability) return await this.runProbe(owner);
      this.requests.assertActive(owner);
      const response = await this.send(
        owner,
        `${testId}-probe-${capability}`,
        [{ id: "probe", text: "hello" }],
        "es",
        capability,
        10_000,
      );
      this.requests.assertActive(owner);
      if (response.statusCode < 200 || response.statusCode >= 300) {
        throw providerHttpErrorFromBody(response.statusCode, response.headers, response.bodyText);
      }
      this.parseResponse(["probe"], response, true);
      return capability;
    } finally {
      this.requests.finish(owner);
    }
  }

  private async runProbe(owner: RequestOwner<undefined>): Promise<Capability> {
    for (const capability of ["strict-json-schema", "json-object", "prompt-json"] as const) {
      this.requests.assertActive(owner);
      const response = await this.send(
        owner,
        `${owner.requestId}-probe-${capability}`,
        [{ id: "probe", text: "hello" }],
        "es",
        capability,
        10_000,
      );
      this.requests.assertActive(owner);
      if (response.statusCode < 200 || response.statusCode >= 300) {
        const failure = providerHttpErrorFromBody(
          response.statusCode,
          response.headers,
          response.bodyText,
        );
        if (this.isCapabilityIncompatibility(response, failure)) continue;
        throw failure;
      }
      this.parseResponse(["probe"], response, true);
      this.capability = capability;
      return capability;
    }
    throw protocolError("OPENAI_CAPABILITY_PROBE_FAILED", "configuration");
  }

  async attempt(
    request: TranslationBatchRequest,
    onProgress?: TranslationProgressHandler,
    assertAuthorized?: () => void,
  ): Promise<TranslationBatchResult> {
    const owner = this.requests.beginRequired({
      senderId: "provider",
      operation: "translation",
      requestId: request.requestId,
      context: undefined,
      assertAuthorized,
    });
    try {
      const capability = this.capability ?? (await this.runProbe(owner));
      this.requests.assertActive(owner);
      return await runTranslationBatches(
        request,
        async (jobId, items) => {
          const response = await this.send(
            owner,
            jobId,
            items,
            request.targetLanguage,
            capability,
            30_000,
          );
          this.requests.assertActive(owner);
          if (response.statusCode < 200 || response.statusCode >= 300)
            throw providerHttpErrorFromBody(
              response.statusCode,
              response.headers,
              response.bodyText,
            );
          return this.parseResponse(
            items.map((item) => item.id),
            response,
          );
        },
        () => this.requests.assertActive(owner),
        onProgress,
        { maxConcurrentWires: 2 },
      );
    } finally {
      this.requests.finish(owner);
    }
  }

  async cancel(requestId: string): Promise<void> {
    await Promise.allSettled([
      this.requests.cancel("provider", "test", requestId),
      this.requests.cancel("provider", "translation", requestId),
    ]);
  }

  private async send(
    owner: RequestOwner<undefined>,
    jobId: string,
    items: WireTranslationTarget[],
    targetLanguage: string,
    capability: Capability,
    timeoutMs: number,
  ): Promise<ProviderTransportResponse> {
    const task = buildTranslationTask({ targetLanguage, targets: items });
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
    return this.requests.transport(owner, this.transport).request({
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
  }

  private isCapabilityIncompatibility(
    response: ProviderTransportResponse,
    failure: ProviderAttemptError,
  ): boolean {
    if (response.statusCode !== 400 && response.statusCode !== 422) return false;
    if (["authentication", "model", "quota"].includes(failure.category)) return false;
    return /(unsupported|not supported|response[_ -]?format|json[_ -]?schema|structured output)/i.test(
      response.bodyText.slice(0, 16_384),
    );
  }

  private parseResponse(
    requestedIds: string[],
    response: ProviderTransportResponse,
    strictProbe = false,
  ): TranslationBatchResult {
    let parsed: Record<string, unknown>;
    try {
      const value: unknown = JSON.parse(response.bodyText);
      if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error();
      parsed = value as Record<string, unknown>;
    } catch {
      throw protocolError("OPENAI_MALFORMED_JSON");
    }
    const choice = Array.isArray(parsed.choices)
      ? (parsed.choices[0] as Record<string, unknown> | undefined)
      : undefined;
    const finishReason = choice?.finish_reason;
    const message = choice?.message as Record<string, unknown> | undefined;
    if (
      finishReason === "content_filter" ||
      (typeof message?.refusal === "string" && message.refusal)
    )
      throw protocolError("OPENAI_REFUSAL", "refusal");
    if (finishReason !== undefined && finishReason !== "stop")
      throw protocolError("OPENAI_INCOMPLETE_OUTPUT");
    if (typeof message?.content !== "string") throw protocolError("OPENAI_MALFORMED_OUTPUT");
    let output: Record<string, unknown>;
    try {
      output = JSON.parse(message.content) as Record<string, unknown>;
    } catch {
      throw protocolError("OPENAI_MALFORMED_OUTPUT");
    }
    if (strictProbe) {
      try {
        validateStrictIdOutput(requestedIds, output);
      } catch {
        throw protocolError("OPENAI_MALFORMED_OUTPUT");
      }
    }
    const usage = parsed.usage as Record<string, unknown> | undefined;
    let validated: TranslationBatchResult;
    try {
      validated = validateIdOutput(requestedIds, {
        ...output,
        usage: {
          ...(typeof usage?.prompt_tokens === "number" ? { input: usage.prompt_tokens } : {}),
          ...(typeof usage?.completion_tokens === "number"
            ? { output: usage.completion_tokens }
            : {}),
        },
      });
    } catch {
      throw protocolError("OPENAI_MALFORMED_OUTPUT");
    }
    return {
      translations: validated.translations,
      ...(validated.usage ? { usage: validated.usage } : {}),
      ...(response.headers["x-request-id"]
        ? { providerRequestId: response.headers["x-request-id"] }
        : {}),
    };
  }
}
