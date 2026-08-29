import { describe, expect, it } from "vitest";
import { discoverProviderModels } from "../../src/providers/model-discovery.js";
import type {
  ProviderTransport,
  ProviderTransportRequest,
  ProviderTransportResponse,
} from "../../src/providers/transport.js";

class CapturingTransport implements ProviderTransport {
  readonly requests: ProviderTransportRequest[] = [];

  constructor(private readonly response: ProviderTransportResponse) {}

  async request(request: ProviderTransportRequest): Promise<ProviderTransportResponse> {
    this.requests.push(request);
    return this.response;
  }
}

class SequenceTransport implements ProviderTransport {
  readonly requests: ProviderTransportRequest[] = [];

  constructor(private readonly responses: ProviderTransportResponse[]) {}

  async request(request: ProviderTransportRequest): Promise<ProviderTransportResponse> {
    this.requests.push(request);
    const response = this.responses.shift();
    if (!response) throw new Error("NO_RESPONSE");
    return response;
  }
}

function response(body: unknown, statusCode = 200): ProviderTransportResponse {
  return { statusCode, headers: {}, bodyText: JSON.stringify(body) };
}

function transport(body: unknown, statusCode = 200): CapturingTransport {
  return new CapturingTransport({
    statusCode,
    headers: {},
    bodyText: typeof body === "string" ? body : JSON.stringify(body),
  });
}

describe("provider model discovery", () => {
  it("paginates Claude last_id through after_id with per-page guards and atomic deduplication", async () => {
    const client = new SequenceTransport([
      response({
        data: [{ id: "model-a" }, { id: "Model-A" }],
        has_more: true,
        last_id: "cursor / one",
      }),
      response({ data: [{ id: "model-a" }, { id: "model-b" }], has_more: false }),
    ]);
    let guardCalls = 0;

    await expect(
      discoverProviderModels(
        {
          jobId: "claude-pages",
          kind: "claude",
          endpoint: "https://api.anthropic.com",
          apiKey: "fictional-key",
          assertActive: () => {
            guardCalls += 1;
          },
        },
        client,
      ),
    ).resolves.toEqual(["model-a", "Model-A", "model-b"]);
    expect(client.requests.map((request) => request.url)).toEqual([
      "https://api.anthropic.com/v1/models",
      "https://api.anthropic.com/v1/models?after_id=cursor%20%2F%20one",
    ]);
    expect(client.requests.map((request) => request.headers)).toEqual([
      { "x-api-key": "fictional-key", "anthropic-version": "2023-06-01" },
      { "x-api-key": "fictional-key", "anthropic-version": "2023-06-01" },
    ]);
    expect(guardCalls).toBe(4);
  });

  it.each([
    ["empty page", [{ data: [], has_more: true, last_id: "next" }]],
    ["empty cursor", [{ data: [{ id: "a" }], has_more: true, last_id: " " }]],
    [
      "repeated cursor",
      [
        { data: [{ id: "a" }], has_more: true, last_id: "same" },
        { data: [{ id: "b" }], has_more: true, last_id: "same" },
      ],
    ],
  ])("rejects Claude %s without a partial catalog", async (_name, pages) => {
    const client = new SequenceTransport(pages.map((page) => response(page)));
    await expect(
      discoverProviderModels(
        {
          jobId: "claude-invalid-pages",
          kind: "claude",
          endpoint: "https://api.anthropic.com",
          apiKey: "fictional-key",
        },
        client,
      ),
    ).rejects.toMatchObject({ category: "protocol", retryable: false });
  });

  it("rejects a later Claude page failure without returning accumulated models", async () => {
    const client = new SequenceTransport([
      response({ data: [{ id: "partial" }], has_more: true, last_id: "next" }),
      response({ error: { type: "overloaded_error", message: "PRIVATE" } }, 529),
    ]);
    const failure = await discoverProviderModels(
      {
        jobId: "claude-late-failure",
        kind: "claude",
        endpoint: "https://api.anthropic.com",
        apiKey: "fictional-key",
      },
      client,
    ).catch((error) => error);
    expect(failure).toMatchObject({ category: "http", retryable: true, statusCode: 529 });
    expect(failure).not.toHaveProperty("models");
    expect(JSON.stringify(failure)).not.toMatch(/partial|PRIVATE/);
  });

  it("stops before the next Claude page when the response owner is superseded", async () => {
    const client = new SequenceTransport([
      response({ data: [{ id: "stale" }], has_more: true, last_id: "next" }),
    ]);
    let guardCalls = 0;
    await expect(
      discoverProviderModels(
        {
          jobId: "claude-stale",
          kind: "claude",
          endpoint: "https://api.anthropic.com",
          apiKey: "fictional-key",
          assertActive: () => {
            guardCalls += 1;
            if (guardCalls === 2)
              throw { category: "cancelled", retryable: false, userAction: "RETRY" };
          },
        },
        client,
      ),
    ).rejects.toMatchObject({ category: "cancelled" });
    expect(client.requests).toHaveLength(1);
  });

  it("uses Claude Models headers, exact deduplication and a configurable API Root", async () => {
    const client = transport({
      data: [
        { id: " model-a " },
        { id: "model-a" },
        { id: "Model-A" },
        { id: "custom/model:v2" },
        { id: " " },
      ],
      has_more: false,
      last_id: "ignored-terminal-cursor",
    });
    await expect(
      discoverProviderModels(
        {
          jobId: "models-claude",
          kind: "claude",
          endpoint: "https://host.example/base/v1/",
          apiKey: "claude-key",
          proxyMode: "direct",
        },
        client,
      ),
    ).resolves.toEqual(["model-a", "Model-A", "custom/model:v2"]);
    expect(client.requests[0]).toEqual({
      jobId: "models-claude",
      method: "GET",
      url: "https://host.example/base/v1/models",
      headers: {
        "x-api-key": "claude-key",
        "anthropic-version": "2023-06-01",
      },
      proxyMode: "direct",
      timeoutMs: 10_000,
      maxResponseBytes: 1_048_576,
    });
  });

  it("accepts the non-paginated model list returned by Ollama's Claude endpoint", async () => {
    const client = transport({
      object: "list",
      data: [
        { id: " translategemma:12b ", object: "model", owned_by: "library" },
        { id: "translategemma:12b", object: "model", owned_by: "library" },
        { id: "qwen3:14b", object: "model", owned_by: "library" },
      ],
    });

    await expect(
      discoverProviderModels(
        {
          jobId: "models-ollama-claude",
          kind: "claude",
          endpoint: "http://127.0.0.1:11434",
          apiKey: "ollama",
          proxyMode: "direct",
        },
        client,
      ),
    ).resolves.toEqual(["translategemma:12b", "qwen3:14b"]);
    expect(client.requests).toHaveLength(1);
    expect(client.requests[0]).toMatchObject({
      method: "GET",
      url: "http://127.0.0.1:11434/v1/models",
      headers: {
        "x-api-key": "ollama",
        "anthropic-version": "2023-06-01",
      },
    });
  });

  it("requires a Claude key and rejects an unsupported or malformed catalog safely", async () => {
    await expect(
      discoverProviderModels(
        { jobId: "missing-key", kind: "claude", endpoint: "https://api.anthropic.com" },
        transport({ data: [], has_more: false }),
      ),
    ).rejects.toMatchObject({ category: "authentication", userAction: "CHECK_CREDENTIALS" });
    const failure = await discoverProviderModels(
      {
        jobId: "unsupported",
        kind: "claude",
        endpoint: "https://api.anthropic.com",
        apiKey: "PRIVATE_CLAUDE_KEY",
      },
      transport({ error: { message: "PRIVATE_MODEL_RESPONSE" } }, 404),
    ).catch((error) => error);
    expect(failure).toMatchObject({
      category: "configuration",
      statusCode: 404,
      userAction: "CHECK_ENDPOINT",
    });
    expect(JSON.stringify(failure)).not.toMatch(/PRIVATE/);
  });

  it("uses the DeepSeek models contract with optional Bearer and exact stable IDs", async () => {
    const client = transport({
      data: [
        { id: " model-a ", owned_by: "deepseek" },
        { id: "model-a" },
        { id: "Model-A" },
        { id: "custom/model:v2" },
        { id: " " },
        { id: 3 },
      ],
    });
    await expect(
      discoverProviderModels(
        {
          jobId: "models-deepseek",
          kind: "deepseek",
          endpoint: "https://API.DeepSeek.com/",
          apiKey: "deepseek-secret",
          proxyMode: "system",
        },
        client,
      ),
    ).resolves.toEqual(["model-a", "Model-A", "custom/model:v2"]);
    expect(client.requests[0]).toEqual({
      jobId: "models-deepseek",
      method: "GET",
      url: "https://api.deepseek.com/models",
      headers: { Authorization: "Bearer deepseek-secret" },
      proxyMode: "system",
      timeoutMs: 10_000,
      maxResponseBytes: 1_048_576,
    });
    await expect(
      discoverProviderModels(
        { jobId: "deepseek-empty", kind: "deepseek", endpoint: "https://api.deepseek.com" },
        transport({ data: [] }),
      ),
    ).resolves.toEqual([]);
  });

  it("rejects malformed and failed DeepSeek catalogs without exposing response data", async () => {
    await expect(
      discoverProviderModels(
        { jobId: "deepseek-invalid", kind: "deepseek", endpoint: "https://api.deepseek.com" },
        transport({ models: [{ id: "wrong-shape" }] }),
      ),
    ).rejects.toMatchObject({
      category: "protocol",
      providerCode: "DEEPSEEK_MODELS_MALFORMED_RESPONSE",
    });
    const failure = await discoverProviderModels(
      {
        jobId: "deepseek-auth",
        kind: "deepseek",
        endpoint: "https://api.deepseek.com",
        apiKey: "PRIVATE_KEY",
      },
      transport({ error: { message: "PRIVATE_RESPONSE" } }, 401),
    ).catch((error) => error);
    expect(failure).toMatchObject({
      category: "authentication",
      statusCode: 401,
      userAction: "CHECK_CREDENTIALS",
    });
    expect(JSON.stringify(failure)).not.toMatch(/PRIVATE/);
  });

  it("extracts every valid OpenAI model without owned_by filtering", async () => {
    const client = transport({
      data: [
        { id: " model-a ", owned_by: "openai" },
        { id: "model-a", owned_by: "other" },
        { id: "Model-A", owned_by: "third" },
        { id: "namespace/model:v2" },
        { id: "   " },
        {},
      ],
    });
    await expect(
      discoverProviderModels(
        {
          jobId: "models-openai",
          kind: "openai",
          endpoint: "https://example.test/v1/",
          apiKey: "secret",
          proxyMode: "direct",
        },
        client,
      ),
    ).resolves.toEqual(["model-a", "Model-A", "namespace/model:v2"]);
    expect(client.requests[0]).toEqual({
      jobId: "models-openai",
      method: "GET",
      url: "https://example.test/v1/models",
      headers: { Authorization: "Bearer secret" },
      proxyMode: "direct",
      timeoutMs: 10_000,
      maxResponseBytes: 1_048_576,
    });
  });

  it("uses one Ollama model value per entry and falls back to name", async () => {
    const client = transport({
      models: [
        { model: "qwen3:8b", name: "ignored" },
        { model: " ", name: "gemma3:4b" },
        { name: "qwen3:8b" },
        { model: 5, name: "llama3.2" },
      ],
    });
    await expect(
      discoverProviderModels(
        {
          jobId: "models-ollama",
          kind: "ollama",
          endpoint: "https://ollama.example.test/",
          proxyMode: "system",
        },
        client,
      ),
    ).resolves.toEqual(["qwen3:8b", "gemma3:4b", "llama3.2"]);
    expect(client.requests[0]?.url).toBe("https://ollama.example.test/api/tags");
    expect(client.requests[0]?.headers).toEqual({});
    expect(client.requests[0]).not.toHaveProperty("body");
  });

  it("treats a valid empty response as an empty catalog", async () => {
    await expect(
      discoverProviderModels(
        { jobId: "empty", kind: "openai", endpoint: "https://example.test/v1" },
        transport({ data: [] }),
      ),
    ).resolves.toEqual([]);
  });

  it.each([
    ["malformed JSON", "{"],
    ["invalid OpenAI structure", { models: [] }],
    ["invalid Ollama structure", { data: [] }],
  ])("rejects %s as a protocol failure", async (_name, body) => {
    const kind = _name.includes("Ollama") ? "ollama" : "openai";
    await expect(
      discoverProviderModels(
        { jobId: "invalid", kind, endpoint: "https://example.test/v1" },
        transport(body),
      ),
    ).rejects.toMatchObject({ category: "protocol" });
  });

  it("classifies non-success HTTP responses safely", async () => {
    await expect(
      discoverProviderModels(
        { jobId: "unauthorized", kind: "ollama", endpoint: "https://example.test" },
        transport({ private: "must-not-escape" }, 401),
      ),
    ).rejects.toEqual({
      category: "authentication",
      retryable: false,
      statusCode: 401,
      userAction: "CHECK_CREDENTIALS",
    });
  });
});
