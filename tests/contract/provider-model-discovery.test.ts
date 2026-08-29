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

function transport(body: unknown, statusCode = 200): CapturingTransport {
  return new CapturingTransport({
    statusCode,
    headers: {},
    bodyText: typeof body === "string" ? body : JSON.stringify(body),
  });
}

describe("provider model discovery", () => {
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
