import { RequestLifecycle, type RequestOwner } from "./request-lifecycle.js";
import type { ConfiguredProvider } from "./provider.js";
import type {
  TranslationBatchRequest,
  TranslationBatchResult,
  TranslationProgressHandler,
  WireTranslationTarget,
} from "./types.js";
import type { ProviderTransport, ProviderTransportResponse } from "./transport.js";
import { providerHttpError, providerHttpErrorFromBody, protocolError } from "./errors.js";
import { normalizeProviderEndpoint } from "./profiles.js";
import { validateIdOutput, validateStrictIdOutput } from "./validation.js";
import { encodeWireItems } from "./wire-items.js";
import { buildOllamaTranslationTask } from "./translation-task.js";

const MAX_ITEMS_PER_CHAT_REQUEST = 1;
type OllamaOutputCapability = "json-schema" | "prompt-json";

export class OllamaProvider implements ConfiguredProvider {
  private readonly endpoint: string;
  private readonly requests = new RequestLifecycle<undefined>();
  private probeSequence = 0;
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
    this.endpoint = normalizeProviderEndpoint("ollama", config.endpoint).replace(/\/+$/, "");
    if (!config.model.trim()) throw new Error("MODEL_REQUIRED");
    const authority = this.endpoint.match(/^https?:\/\/([^/]+)/i)?.[1]?.toLowerCase() ?? "";
    this.outputCapability =
      authority === "ollama.com" || authority.startsWith("ollama.com:")
        ? "prompt-json"
        : "json-schema";
  }

  async probe(): Promise<{ version: string; model: string }> {
    return this.testConnection(`probe-${++this.probeSequence}`);
  }

  async testConnection(testId: string): Promise<{ version: string; model: string }> {
    const owner = this.requests.beginRequired({
      senderId: "provider",
      operation: "test",
      requestId: testId,
      context: undefined,
    });
    try {
      return await this.runProbe(owner);
    } finally {
      this.requests.finish(owner);
    }
  }

  private async runProbe(
    owner: RequestOwner<undefined>,
  ): Promise<{ version: string; model: string }> {
    this.requests.assertActive(owner);
    const versionResponse = await this.get(owner, `${owner.requestId}-version`, "/api/version");
    this.requests.assertActive(owner);
    if (versionResponse.statusCode !== 200)
      throw providerHttpError(versionResponse.statusCode, versionResponse.headers);
    const version = this.json(versionResponse.bodyText).version;
    const tagsResponse = await this.get(owner, `${owner.requestId}-tags`, "/api/tags");
    this.requests.assertActive(owner);
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
      owner,
      `${owner.requestId}-schema`,
      [{ id: "probe", text: "hello" }],
      "es",
      15_000,
      true,
    );
    this.requests.assertActive(owner);
    return { version: typeof version === "string" ? version : "unknown", model: this.config.model };
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
      const wire = encodeWireItems(request.items);
      const combined: TranslationBatchResult = { translations: [] };
      let isolatedFailure: unknown;
      for (let offset = 0; offset < wire.items.length; offset += MAX_ITEMS_PER_CHAT_REQUEST) {
        this.requests.assertActive(owner);
        const items = wire.items.slice(offset, offset + MAX_ITEMS_PER_CHAT_REQUEST);
        const part = Math.floor(offset / MAX_ITEMS_PER_CHAT_REQUEST) + 1;
        let parsed: TranslationBatchResult;
        try {
          parsed = await this.validatedChat(
            owner,
            `${request.requestId}-part-${part}`,
            items,
            request.targetLanguage,
            60_000,
          );
        } catch (error) {
          if (wire.items.length <= 1 || !this.isIsolatedWireFailure(error)) throw error;
          isolatedFailure = error;
          continue;
        }
        this.requests.assertActive(owner);
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
      this.requests.assertActive(owner);
      if (combined.translations.length === 0 && isolatedFailure) throw isolatedFailure;
      return wire.restore(combined);
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

  private async get(
    owner: RequestOwner<undefined>,
    jobId: string,
    path: string,
  ): Promise<ProviderTransportResponse> {
    return this.requests.transport(owner, this.transport).request({
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
  }

  private async chat(
    owner: RequestOwner<undefined>,
    jobId: string,
    items: WireTranslationTarget[],
    targetLanguage: string,
    timeoutMs: number,
    capability = this.outputCapability,
  ): Promise<ProviderTransportResponse> {
    const task = buildOllamaTranslationTask({ targetLanguage, targets: items });
    return this.requests.transport(owner, this.transport).request({
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
        think: false,
        ...(capability === "json-schema" ? { format: task.outputSchema } : {}),
        options: { temperature: 0 },
        messages: [{ role: "user", content: task.userMessage }],
      },
      timeoutMs,
      maxResponseBytes: 1_048_576,
    });
  }

  private async validatedChat(
    owner: RequestOwner<undefined>,
    jobId: string,
    items: WireTranslationTarget[],
    targetLanguage: string,
    timeoutMs: number,
    strictProbe = false,
  ): Promise<TranslationBatchResult> {
    const initialCapability = this.outputCapability;
    let response = await this.chat(
      owner,
      jobId,
      items,
      targetLanguage,
      timeoutMs,
      initialCapability,
    );
    this.requests.assertActive(owner);
    if (response.statusCode < 200 || response.statusCode >= 300) {
      if (initialCapability !== "json-schema" || !this.isStructuredOutputIncompatibility(response))
        throw providerHttpErrorFromBody(response.statusCode, response.headers, response.bodyText);
      this.outputCapability = "prompt-json";
      response = await this.chat(
        owner,
        this.fallbackJobId(jobId),
        items,
        targetLanguage,
        timeoutMs,
        "prompt-json",
      );
      this.requests.assertActive(owner);
      if (response.statusCode < 200 || response.statusCode >= 300)
        throw providerHttpErrorFromBody(response.statusCode, response.headers, response.bodyText);
      return this.parse(items, response, strictProbe);
    }
    return this.parse(items, response, strictProbe);
  }

  private fallbackJobId(jobId: string): string {
    return jobId.endsWith("-schema") ? `${jobId.slice(0, -7)}-prompt` : `${jobId}-prompt`;
  }

  private isIsolatedWireFailure(error: unknown): boolean {
    if (!error || typeof error !== "object" || Array.isArray(error)) return false;
    const category = (error as Record<string, unknown>).category;
    return category === "timeout" || category === "protocol";
  }

  private isStructuredOutputIncompatibility(response: ProviderTransportResponse): boolean {
    if (response.statusCode !== 400 && response.statusCode !== 422) return false;
    const message = response.bodyText.slice(0, 16_384);
    return (
      /\b(?:format|json.?schema|structured output)\b/i.test(message) &&
      /unsupported|not supported|does not support|not implemented|unrecognized|unknown|invalid/i.test(
        message,
      )
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
    items: WireTranslationTarget[],
    response: ProviderTransportResponse,
    strictProbe = false,
  ): TranslationBatchResult {
    const requestedIds = items.map((item) => item.id);
    const parsed = this.json(response.bodyText);
    const message = parsed.message as Record<string, unknown> | undefined;
    if (
      parsed.done_reason === "content_filter" ||
      parsed.done_reason === "refusal" ||
      (typeof message?.refusal === "string" && message.refusal)
    )
      throw protocolError("OLLAMA_REFUSAL", "refusal");
    if (parsed.done_reason !== undefined && parsed.done_reason !== "stop")
      throw protocolError("OLLAMA_INCOMPLETE_OUTPUT");
    if (typeof message?.content !== "string") throw protocolError("OLLAMA_MALFORMED_OUTPUT");
    const content = message.content.trim();
    const fenced = content.match(/^```(?:json)?\s*\n?([\s\S]*?)\n?```$/i);
    let validated: TranslationBatchResult;
    try {
      const output = fenced ? fenced[1]!.trim() : content;
      if (strictProbe) validateStrictIdOutput(requestedIds, output);
      validated = validateIdOutput(requestedIds, output);
    } catch {
      throw protocolError("OLLAMA_MALFORMED_OUTPUT");
    }
    const targets = new Map(items.map((item) => [item.id, item]));
    const translations = validated.translations.filter((translation) => {
      const target = targets.get(translation.id);
      return target && !this.isContaminatedText(target, translation.text);
    });
    if (strictProbe) {
      try {
        validateStrictIdOutput(requestedIds, { translations });
      } catch {
        throw protocolError("OLLAMA_MALFORMED_OUTPUT");
      }
    }
    return {
      translations,
      usage: {
        ...(typeof parsed.prompt_eval_count === "number"
          ? { input: parsed.prompt_eval_count }
          : {}),
        ...(typeof parsed.eval_count === "number" ? { output: parsed.eval_count } : {}),
      },
    };
  }

  private isContaminatedText(target: WireTranslationTarget, text: string): boolean {
    if (text === target.text) return false;
    const lines = text.split(/\r?\n/);
    if (lines.some((line) => line === target.text)) return true;
    return (
      /["'](?:target_language|targets|translations|context_previous|context_next|id|text)["']\s*:/i.test(
        text,
      ) ||
      /<\/?thin(?:k(?:ing)?)?\b|```/i.test(text) ||
      /^\s*(?:translation|translated text|note|explanation|reasoning)\s*[:：]/i.test(text)
    );
  }
}
