import { describe, expect, it } from "vitest";
import { DeepSeekProvider } from "../../src/providers/deepseek.js";
import type {
  ProviderTransport,
  ProviderTransportRequest,
  ProviderTransportResponse,
} from "../../src/providers/transport.js";
import { makeProviderRequest } from "./provider-test-helpers.js";

function successResponse(request: ProviderTransportRequest): ProviderTransportResponse {
  const messages = (request.body as { messages: Array<{ content: string }> }).messages;
  const targets = (JSON.parse(messages.at(-1)!.content) as { targets: Array<{ id: string }> })
    .targets;
  return {
    statusCode: 200,
    headers: { "x-request-id": "safe-request-1" },
    bodyText: JSON.stringify({
      choices: [
        {
          finish_reason: "stop",
          message: {
            content: JSON.stringify({
              translations: targets.map((target) => ({ id: target.id, text: `T:${target.id}` })),
            }),
          },
        },
      ],
      usage: { prompt_tokens: 4, completion_tokens: 2 },
    }),
  };
}

describe("DeepSeek provider", () => {
  it("uses the fixed JSON object dialect, disabled thinking and JSON-only instructions", async () => {
    const requests: ProviderTransportRequest[] = [];
    const provider = new DeepSeekProvider(
      { endpoint: "https://api.deepseek.com", model: "exact-model", apiKey: "secret" },
      { request: async (request) => (requests.push(request), successResponse(request)) },
    );

    await provider.testConnection("dialect-test");
    await provider.attempt(makeProviderRequest());

    expect(requests).toHaveLength(2);
    for (const request of requests) {
      expect(request.headers).toEqual({
        "Content-Type": "application/json",
        Authorization: "Bearer secret",
      });
      const body = request.body as Record<string, unknown>;
      expect(body).toMatchObject({
        model: "exact-model",
        stream: false,
        temperature: 0,
        thinking: { type: "disabled" },
        response_format: { type: "json_object" },
      });
      expect(body.response_format).toEqual({ type: "json_object" });
      expect(body).not.toHaveProperty("json_schema");
      expect(JSON.stringify(body)).not.toMatch(/outputSchema|strict-json-schema|X-Session-Id/);
      const messages = body.messages as Array<{ role: string; content: string }>;
      expect(messages[0]!.content).toMatch(/JSON/i);
      expect(messages[0]!.content).toMatch(/one JSON object/i);
      expect(messages[0]!.content).toContain('"translations"');
      expect(messages[0]!.content).toMatch(/exactly once/i);
      expect(messages[0]!.content).toMatch(/no (additional|extra) id/i);
      expect(messages[0]!.content).toMatch(/non-empty/i);
      expect(() => JSON.parse(messages[1]!.content)).not.toThrow();
    }
  });

  it("performs every Test as one fresh Chat Completions request without a capability probe", async () => {
    const requests: ProviderTransportRequest[] = [];
    const provider = new DeepSeekProvider(
      {
        endpoint: "https://api.deepseek.com/",
        model: "exact-model",
        apiKey: "secret",
      },
      { request: async (request) => (requests.push(request), successResponse(request)) },
    );

    await expect(provider.testConnection("test-one")).resolves.toBeDefined();
    await expect(provider.testConnection("test-two")).resolves.toBeDefined();

    expect(requests).toHaveLength(2);
    expect(requests.map((request) => request.jobId)).toEqual(["test-one", "test-two"]);
    expect(
      requests.every((request) => request.url === "https://api.deepseek.com/chat/completions"),
    ).toBe(true);
    expect(requests.every((request) => request.headers.Authorization === "Bearer secret")).toBe(
      true,
    );
    expect(requests.some((request) => request.jobId.includes("probe"))).toBe(false);
  });

  it("publishes validated one-item and two-item wires progressively", async () => {
    const requests: ProviderTransportRequest[] = [];
    const provider = new DeepSeekProvider(
      { endpoint: "https://api.deepseek.com", model: "exact-model" },
      { request: async (request) => (requests.push(request), successResponse(request)) },
    );
    const request = makeProviderRequest();
    request.items = Array.from({ length: 5 }, (_, index) => ({
      id: `source-${index + 1}`,
      text: `text-${index + 1}`,
    }));
    const progress: string[][] = [];

    const result = await provider.attempt(request, (value) =>
      progress.push(value.translations.map((translation) => translation.id)),
    );

    expect(requests.map((value) => value.jobId)).toEqual([
      "request-part-1",
      "request-part-2",
      "request-part-3",
    ]);
    expect(progress).toEqual([["source-1", "source-2"], ["source-3", "source-4"], ["source-5"]]);
    expect(result.translations.map((translation) => translation.id)).toEqual([
      "source-1",
      "source-2",
      "source-3",
      "source-4",
      "source-5",
    ]);
    expect(result.usage).toEqual({ input: 12, output: 6 });
  });

  it("cancels every active transport job owned by the request", async () => {
    let release!: (response: ProviderTransportResponse) => void;
    const pending = new Promise<ProviderTransportResponse>((resolve) => {
      release = resolve;
    });
    const cancelled: string[] = [];
    const transport: ProviderTransport = {
      request: async () => pending,
      cancel: async (jobId) => {
        cancelled.push(jobId);
        release({ statusCode: 200, headers: {}, bodyText: "{}" });
      },
    };
    const provider = new DeepSeekProvider(
      { endpoint: "https://api.deepseek.com", model: "exact-model" },
      transport,
    );
    const attempt = provider.attempt(makeProviderRequest());
    await Promise.resolve();

    await provider.cancel("request");

    await expect(attempt).rejects.toMatchObject({
      category: "cancelled",
      providerCode: "REQUEST_CANCELLED",
    });
    expect(cancelled).toEqual(["request-part-1"]);
  });

  it.each([
    ["empty content", { choices: [{ finish_reason: "stop", message: { content: "" } }] }],
    ["length", { choices: [{ finish_reason: "length", message: { content: "{}" } }] }],
    ["refusal", { choices: [{ finish_reason: "content_filter", message: { content: "{}" } }] }],
    ["malformed outer", "{"],
  ])("rejects %s without publishing progress", async (_name, responseBody) => {
    const progress: unknown[] = [];
    const provider = new DeepSeekProvider(
      { endpoint: "https://api.deepseek.com", model: "exact-model" },
      {
        request: async () => ({
          statusCode: 200,
          headers: {},
          bodyText: typeof responseBody === "string" ? responseBody : JSON.stringify(responseBody),
        }),
      },
    );

    await expect(
      provider.attempt(makeProviderRequest(), (value) => progress.push(value)),
    ).rejects.toMatchObject({ retryable: false });
    expect(progress).toEqual([]);
  });
});
