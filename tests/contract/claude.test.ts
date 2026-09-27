import { registerLifecycleContract } from "../helpers/provider-lifecycle-contract.js";
import { registerFailureContract } from "../helpers/provider-failure-contract.js";
import { registerProbeContract } from "../helpers/provider-probe-contract.js";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ClaudeProvider } from "../../src/providers/claude.js";
import type {
  ProviderTransport,
  ProviderTransportRequest,
  ProviderTransportResponse,
} from "../../src/providers/transport.js";
import { makeProviderRequest } from "./provider-test-helpers.js";
import { providerOutputSchema } from "../../src/providers/wire-items.js";

const successFixture = JSON.parse(
  readFileSync("tests/fixtures/providers/claude-success.json", "utf8"),
) as Record<string, unknown>;
const aihubmixHaikuSuccessFixture = JSON.parse(
  readFileSync("tests/fixtures/providers/claude-aihubmix-haiku-success.json", "utf8"),
) as Record<string, unknown>;

function successResponse(request: ProviderTransportRequest): ProviderTransportResponse {
  const body = request.body as { messages: Array<{ content: string }> };
  const targets = (JSON.parse(body.messages[0]!.content) as { targets: Array<{ id: string }> })
    .targets;
  const candidate = JSON.stringify({
    translations: targets.map((target) => ({ id: target.id, text: `T:${target.id}` })),
  });
  const split = Math.floor(candidate.length / 2);
  return {
    statusCode: 200,
    headers: { "request-id": "safe-request-1" },
    bodyText: JSON.stringify({
      ...successFixture,
      content: [
        { type: "text", text: candidate.slice(0, split) },
        { type: "text", text: candidate.slice(split) },
      ],
    }),
  };
}

function provider(
  transport: ProviderTransport,
  endpoint = "https://api.anthropic.com/",
): ClaudeProvider {
  return new ClaudeProvider(
    {
      endpoint,
      model: "exact-model-id",
      apiKey: "fictional-key",
      proxyMode: "system",
    },
    transport,
  );
}

describe("Claude provider", () => {
  it("preserves same-language and mixed-batch text character-for-character", async () => {
    let systemMessage = "";
    const value = provider({
      request: async (request) => {
        const body = request.body as { system: string; messages: Array<{ content: string }> };
        systemMessage = body.system;
        const targets = JSON.parse(body.messages[0]!.content).targets as Array<{
          id: string;
          text: string;
        }>;
        return {
          statusCode: 200,
          headers: {},
          bodyText: JSON.stringify({
            ...successFixture,
            content: [{ type: "text", text: JSON.stringify({ translations: targets }) }],
          }),
        };
      },
    });
    const request = makeProviderRequest();
    request.items = [
      { id: "same-a", text: "  Same.  " },
      { id: "same-b", text: "Line one.\n\nLine three.\n" },
    ];

    const result = await value.attempt(request);

    expect(result.translations).toEqual(request.items.map(({ id, text }) => ({ id, text })));
    expect(systemMessage).toMatch(/character-for-character/i);
    expect(systemMessage).toMatch(/context.*never.*output/i);
  });

  it.each([
    ["https://api.anthropic.com", "https://api.anthropic.com/v1/messages"],
    ["https://host.example/base/", "https://host.example/base/v1/messages"],
    ["https://host.example/base/v1/", "https://host.example/base/v1/messages"],
  ])("uses the normalized Messages URL for %s", async (endpoint, expectedUrl) => {
    const requests: ProviderTransportRequest[] = [];
    const value = provider(
      { request: async (request) => (requests.push(request), successResponse(request)) },
      endpoint,
    );

    await value.testConnection("claude-test");

    expect(requests[0]!.url).toBe(expectedUrl);
  });

  it("sends native non-streaming Messages fields and strict top-level instructions", async () => {
    const requests: ProviderTransportRequest[] = [];
    const value = provider({
      request: async (request) => (requests.push(request), successResponse(request)),
    });

    await value.testConnection("fresh-test");
    await value.attempt(makeProviderRequest());

    expect(requests).toHaveLength(2);
    expect(requests.map((request) => request.timeoutMs)).toEqual([60_000, 60_000]);
    for (const request of requests) {
      expect(request.headers).toEqual({
        "Content-Type": "application/json",
        "x-api-key": "fictional-key",
        "anthropic-version": "2023-06-01",
      });
      const body = request.body as Record<string, unknown>;
      expect(body).toMatchObject({
        model: "exact-model-id",
        max_tokens: 8192,
        stream: false,
        thinking: { type: "disabled" },
      });
      expect(body.system).toEqual(expect.any(String));
      expect(body.messages).toEqual([
        {
          role: "user",
          content: expect.any(String),
        },
      ]);
      expect(JSON.parse((body.messages as Array<{ content: string }>)[0]!.content)).toMatchObject({
        targets: expect.any(Array),
      });
      const targetIds = (
        JSON.parse((body.messages as Array<{ content: string }>)[0]!.content) as {
          targets: Array<{ id: string }>;
        }
      ).targets.map((target) => target.id);
      expect(body.output_config).toEqual({
        format: { type: "json_schema", schema: providerOutputSchema(targetIds) },
      });
      expect(String(body.system)).toMatch(/untrusted data|untrusted/i);
      expect(String(body.system)).toMatch(/Spanish \[es\]|Chinese \(Simplified\) \[zh-Hans\]/);
      expect(String(body.system)).toMatch(/source language.*independently/i);
      expect(String(body.system)).not.toMatch(/from English \[en\]/);
      expect(String(body.system)).toMatch(/exactly once/i);
      expect(String(body.system)).toContain('"translations"');
      for (const forbidden of [
        "temperature",
        "top_p",
        "top_k",
        "response_format",
        "format",
        "tools",
        "metadata",
      ])
        expect(body).not.toHaveProperty(forbidden);
      expect(request.headers).not.toHaveProperty("X-Session-Id");
    }
    expect(
      requests.map((request) => String((request.body as Record<string, unknown>).system)),
    ).toEqual([
      expect.stringContaining("Spanish [es]"),
      expect.stringContaining("Chinese (Simplified) [zh-Hans]"),
    ]);
  });

  it.each([
    [400, '"output_config.format" is not supported'],
    [422, "JSON Schema structured output is unsupported"],
  ])(
    "retries once without structured output after an explicit HTTP %s rejection and caches it",
    async (statusCode, message) => {
      const requests: ProviderTransportRequest[] = [];
      const value = provider({
        request: async (request) => {
          requests.push(request);
          if (requests.length === 1)
            return {
              statusCode,
              headers: {},
              bodyText: JSON.stringify({
                type: "error",
                error: { type: "invalid_request_error", message },
              }),
            };
          return successResponse(request);
        },
      });

      await expect(value.attempt(makeProviderRequest())).resolves.toMatchObject({
        translations: [{ id: "c1" }, { id: "c2" }],
      });
      await expect(value.testConnection("cached-structured-output-test")).resolves.toEqual({
        model: "exact-model-id",
      });

      expect(requests.map((request) => request.jobId)).toEqual([
        "request-part-1",
        "request-part-1-without-output-config",
        "cached-structured-output-test",
      ]);
      expect(requests[0]!.body).toHaveProperty("output_config");
      expect(requests[1]!.body).not.toHaveProperty("output_config");
      expect(requests[2]!.body).not.toHaveProperty("output_config");
    },
  );

  it.each([
    [400, "invalid messages"],
    [401, '"output_config" is not supported'],
    [404, '"output_config" is not supported'],
    [402, '"output_config" is not supported'],
  ])("does not omit structured output for HTTP %s: %s", async (statusCode, message) => {
    const requests: ProviderTransportRequest[] = [];
    const value = provider({
      request: async (request) => {
        requests.push(request);
        return {
          statusCode,
          headers: {},
          bodyText: JSON.stringify({
            type: "error",
            error: { type: "invalid_request_error", message },
          }),
        };
      },
    });

    await expect(value.attempt(makeProviderRequest())).rejects.toMatchObject({ retryable: false });
    expect(requests).toHaveLength(1);
    expect(requests[0]!.body).toHaveProperty("output_config");
  });

  it("retries once without thinking only when a compatible service explicitly rejects it", async () => {
    const requests: ProviderTransportRequest[] = [];
    const value = provider({
      request: async (request) => {
        requests.push(request);
        if (requests.length === 1)
          return {
            statusCode: 400,
            headers: {},
            bodyText: JSON.stringify({
              type: "error",
              error: {
                type: "invalid_request_error",
                message: '"thinking.type.disabled" is not supported for this model',
              },
            }),
          };
        return successResponse(request);
      },
    });

    await expect(value.attempt(makeProviderRequest())).resolves.toMatchObject({
      translations: [{ id: "c1" }, { id: "c2" }],
    });

    expect(requests.map((request) => request.jobId)).toEqual([
      "request-part-1",
      "request-part-1-without-thinking",
    ]);
    expect(requests[0]!.body).toMatchObject({ thinking: { type: "disabled" } });
    expect(requests[1]!.body).not.toHaveProperty("thinking");
  });

  it("does not retry a rejected request that is unrelated to thinking compatibility", async () => {
    const requests: ProviderTransportRequest[] = [];
    const value = provider({
      request: async (request) => {
        requests.push(request);
        return {
          statusCode: 400,
          headers: {},
          bodyText: JSON.stringify({
            type: "error",
            error: { type: "invalid_request_error", message: "invalid messages" },
          }),
        };
      },
    });

    await expect(value.attempt(makeProviderRequest())).rejects.toMatchObject({
      category: "configuration",
      retryable: false,
    });
    expect(requests).toHaveLength(1);
  });

  it("runs every Test as a fresh validated Messages request without selecting", async () => {
    const requests: ProviderTransportRequest[] = [];
    const value = provider({
      request: async (request) => (requests.push(request), successResponse(request)),
    });

    await expect(value.testConnection("test-one")).resolves.toEqual({ model: "exact-model-id" });
    await expect(value.testConnection("test-two")).resolves.toEqual({ model: "exact-model-id" });

    expect(requests.map((request) => request.jobId)).toEqual(["test-one", "test-two"]);
  });

  it("concatenates ordered text blocks, accumulates safe usage and publishes per wire", async () => {
    const requests: ProviderTransportRequest[] = [];
    const value = provider({
      request: async (request) => (requests.push(request), successResponse(request)),
    });
    const request = makeProviderRequest();
    request.items = Array.from({ length: 5 }, (_, index) => ({
      id: `source-${index + 1}`,
      text: `text-${index + 1}`,
    }));
    const progress: string[][] = [];

    const result = await value.attempt(request, (part) =>
      progress.push(part.translations.map((translation) => translation.id)),
    );

    expect(requests.map((item) => item.jobId)).toEqual([
      "request-part-1",
      "request-part-2",
      "request-part-3",
    ]);
    expect(progress).toEqual([["source-1", "source-2"], ["source-3", "source-4"], ["source-5"]]);
    expect(result.translations.map((translation) => translation.id)).toEqual(
      request.items.map((item) => item.id),
    );
    expect(result.usage).toEqual({ input: 72, output: 54 });
    expect(result.providerRequestId).toBe("safe-request-1");
  });

  it("accepts the fenced requested-ID map returned by the AIHubMix Haiku fixture", async () => {
    const value = provider({
      request: async () => ({
        statusCode: 200,
        headers: {},
        bodyText: JSON.stringify(aihubmixHaikuSuccessFixture),
      }),
    });

    await expect(value.attempt(makeProviderRequest())).resolves.toEqual({
      translations: [
        { id: "c1", text: "Fictional translation A" },
        { id: "c2", text: "Fictional translation B" },
      ],
      usage: { input: 24, output: 18 },
    });
  });

  it("reports a successful HTTP response with incompatible output as a protocol failure without retrying", async () => {
    const requests: ProviderTransportRequest[] = [];
    const value = provider({
      request: async (request) => {
        requests.push(request);
        return {
          statusCode: 200,
          headers: {},
          bodyText: JSON.stringify({
            ...successFixture,
            content: [{ type: "text", text: "not-json" }],
          }),
        };
      },
    });

    await expect(value.testConnection("protocol-test")).rejects.toMatchObject({
      category: "protocol",
      retryable: false,
    });
    expect(requests).toHaveLength(1);
  });

  it.each([
    ["outer shape", { content: [], stop_reason: "end_turn" }, "protocol"],
    ["refusal reason", { ...successFixture, stop_reason: "refusal" }, "refusal"],
    [
      "refusal detail",
      { ...successFixture, stop_reason: "end_turn", stop_details: { type: "refusal" } },
      "refusal",
    ],
    [
      "refusal block",
      { ...successFixture, content: [{ type: "refusal", refusal: "private" }] },
      "refusal",
    ],
    ["truncated", { ...successFixture, stop_reason: "max_tokens" }, "protocol"],
    ["empty content", { ...successFixture, content: [] }, "protocol"],
    ["non-text content", { ...successFixture, content: [{ type: "tool_use" }] }, "protocol"],
    [
      "wrapped JSON",
      { ...successFixture, content: [{ type: "text", text: 'Result: {"translations":[]}' }] },
      "protocol",
    ],
    ["malformed JSON", { ...successFixture, content: [{ type: "text", text: "{" }] }, "protocol"],
  ])("rejects %s without publishing the current wire", async (_name, body, category) => {
    const progress: unknown[] = [];
    const value = provider({
      request: async () => ({ statusCode: 200, headers: {}, bodyText: JSON.stringify(body) }),
    });

    await expect(
      value.attempt(makeProviderRequest(), (part) => progress.push(part)),
    ).rejects.toMatchObject({ category, retryable: false });
    expect(progress).toEqual([]);
  });

  it.each([
    [401, "authentication", false, "CHECK_CREDENTIALS"],
    [402, "quota", false, "CHECK_QUOTA"],
    [404, "model", false, "CHECK_MODEL"],
    [429, "http", true, "CHECK_NETWORK"],
    [504, "timeout", true, "CHECK_NETWORK"],
    [529, "http", true, "CHECK_NETWORK"],
  ] as const)("maps HTTP %s to a safe failure", async (statusCode, category, retryable, action) => {
    const value = provider({
      request: async () => ({
        statusCode,
        headers: { "request-id": "safe-request" },
        bodyText: JSON.stringify({ error: { type: "unknown-private", message: "private" } }),
      }),
    });

    const failure = await value.attempt(makeProviderRequest()).catch((error) => error);

    expect(failure).toMatchObject({ category, retryable, statusCode, userAction: action });
    expect(JSON.stringify(failure)).not.toMatch(/unknown-private|private/);
  });

  it("cancels every active transport job owned by the request", async () => {
    let release!: (response: ProviderTransportResponse) => void;
    const pending = new Promise<ProviderTransportResponse>((resolve) => {
      release = resolve;
    });
    const cancelled: string[] = [];
    const value = provider({
      request: async () => pending,
      cancel: async (jobId) => {
        cancelled.push(jobId);
        release({ statusCode: 200, headers: {}, bodyText: "{}" });
      },
    });
    const attempt = value.attempt(makeProviderRequest());
    await Promise.resolve();

    await value.cancel("request");

    await expect(attempt).rejects.toMatchObject({
      category: "cancelled",
      providerCode: "REQUEST_CANCELLED",
    });
    expect(cancelled).toEqual(["request-part-1"]);
  });

  it("classifies unavailable model responses without retaining Provider diagnostics", async () => {
    const value = provider({
      request: async () => ({
        statusCode: 400,
        headers: {},
        bodyText: JSON.stringify({
          type: "error",
          error: {
            type: "invalid_request_error",
            message: "The requested model is not supported: PRIVATE_MODEL_RESPONSE",
          },
        }),
      }),
    });

    const testFailure = await value
      .testConnection("unavailable-model-test")
      .catch((error) => error);
    const sessionFailure = await value.attempt(makeProviderRequest()).catch((error) => error);

    for (const failure of [testFailure, sessionFailure]) {
      expect(failure).toMatchObject({
        category: "model",
        retryable: false,
        statusCode: 400,
        userAction: "CHECK_MODEL",
      });
      expect(failure).not.toHaveProperty("providerCode");
      expect(JSON.stringify(failure)).not.toMatch(/invalid_request_error|PRIVATE_MODEL_RESPONSE/);
    }
  });
});

registerProbeContract(
  "claude",
  (transport) =>
    new ClaudeProvider({ endpoint: "https://fixture.test", model: "model" }, transport),
);

registerFailureContract(
  "claude",
  (transport) =>
    new ClaudeProvider({ endpoint: "https://fixture.test", model: "model" }, transport),
);

registerLifecycleContract(
  "claude",
  (transport) =>
    new ClaudeProvider({ endpoint: "https://fixture.test", model: "model" }, transport),
);
