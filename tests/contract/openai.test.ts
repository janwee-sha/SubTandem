import { describe, expect, it } from "vitest";
import { OpenAICompatibleProvider } from "../../src/providers/openai.js";
import type { ProviderTransport } from "../../src/providers/transport.js";
import { buildTranslationTask } from "../../src/providers/translation-task.js";
import { makeProviderRequest } from "./provider-test-helpers.js";

describe("OpenAI-compatible provider", () => {
  it.each(["strict-json-schema", "json-object", "prompt-json"] as const)(
    "uses the shared directional target contract in %s mode",
    async (capability) => {
      let capturedBody: Record<string, unknown> | undefined;
      const provider = new OpenAICompatibleProvider(
        {
          endpoint: "https://example.test/v1",
          model: "model",
          capability,
          sessionId: "session",
        },
        {
          request: async (request) => {
            capturedBody = request.body as Record<string, unknown>;
            const messages = capturedBody.messages as Array<{ content: string }>;
            const payload = JSON.parse(messages[1]!.content) as {
              targets: Array<{ id: string; text: string }>;
            };
            return {
              statusCode: 200,
              headers: {},
              bodyText: JSON.stringify({
                choices: [
                  {
                    finish_reason: "stop",
                    message: {
                      content: JSON.stringify({
                        translations: payload.targets.map((target) => ({
                          id: target.id,
                          text: `T:${target.text}`,
                        })),
                      }),
                    },
                  },
                ],
              }),
            };
          },
        },
      );

      await provider.attempt(makeProviderRequest());

      const messages = capturedBody!.messages as Array<{ content: string }>;
      const payload = JSON.parse(messages[1]!.content);
      const expectedTask = buildTranslationTask({
        sourceLanguage: "en",
        targetLanguage: "zh-Hans",
        targets: [
          { id: "c1", text: "one", context_next: "two" },
          { id: "c2", text: "two", context_previous: "one" },
        ],
      });
      expect(payload).toEqual(JSON.parse(expectedTask.userMessage));
      expect(messages[0]!.content).toBe(expectedTask.systemMessage);
      expect(JSON.stringify(payload)).not.toContain('"items"');
      if (capability === "strict-json-schema")
        expect(
          (capturedBody!.response_format as { json_schema: { schema: unknown } }).json_schema
            .schema,
        ).toEqual(expectedTask.outputSchema);
    },
  );

  it("probes strict schema then persists the working capability", async () => {
    const modes: string[] = [];
    const transport: ProviderTransport = {
      request: async (request) => {
        modes.push(
          (request.body as { response_format?: { type?: string } }).response_format?.type ??
            "prompt-json",
        );
        if (modes.length === 1) return { statusCode: 400, headers: {}, bodyText: "unsupported" };
        return {
          statusCode: 200,
          headers: {},
          bodyText: JSON.stringify({
            choices: [
              {
                finish_reason: "stop",
                message: { content: '{"translations":[{"id":"probe","text":"hola"}]}' },
              },
            ],
          }),
        };
      },
    };
    const provider = new OpenAICompatibleProvider(
      {
        endpoint: "https://example.test/v1",
        model: "model",
        apiKey: "key",
        sessionId: "session",
      },
      transport,
    );
    await expect(provider.probe()).resolves.toBe("json-object");
    expect(modes).toEqual(["json_schema", "json_object"]);
  });

  it("uses non-stream chat, model/auth and strict local ID mapping without real-batch fallback", async () => {
    const calls: unknown[] = [];
    const provider = new OpenAICompatibleProvider(
      {
        endpoint: "https://example.test/v1/",
        model: "model",
        apiKey: "key",
        capability: "strict-json-schema",
        sessionId: "session",
      },
      {
        request: async (request) => {
          calls.push(request);
          return {
            statusCode: 200,
            headers: {},
            bodyText: JSON.stringify({
              choices: [
                {
                  finish_reason: "stop",
                  message: {
                    content:
                      '{"translations":[{"id":"c1","text":"一"},{"id":"unknown","text":"x"}]}',
                  },
                },
              ],
              usage: { prompt_tokens: 10, completion_tokens: 2 },
            }),
          };
        },
      },
    );
    const request = makeProviderRequest();
    request.items[0]!.id = "srt:0:0:1000";
    request.items[1]!.id = "srt:1:1000:2000";
    const result = await provider.attempt(request);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      url: "https://example.test/v1/chat/completions",
      headers: { Authorization: "Bearer key" },
      body: { model: "model", stream: false },
    });
    const userMessage = (
      calls[0] as { body: { messages: Array<{ content: string }> } }
    ).body.messages.at(-1)?.content;
    const systemMessage = (calls[0] as { body: { messages: Array<{ content: string }> } }).body
      .messages[0]?.content;
    expect(systemMessage).toContain("English [en]");
    expect(systemMessage).toContain("Chinese (Simplified) [zh-Hans]");
    expect(userMessage).toContain('"id":"c1"');
    expect(userMessage).not.toContain("srt:0:0:1000");
    expect(result.translations).toEqual([{ id: "srt:0:0:1000", text: "一" }]);
  });

  it("sends larger batches as two-item compatible chat requests without duplicating text", async () => {
    const calls: Array<Array<{ id: string; text: string }>> = [];
    const provider = new OpenAICompatibleProvider(
      {
        endpoint: "https://example.test/v1",
        model: "model",
        capability: "json-object",
        sessionId: "session",
      },
      {
        request: async (request) => {
          const messages = (request.body as { messages: Array<{ content: string }> }).messages;
          const payload = JSON.parse(messages.at(-1)!.content) as {
            targets: Array<{ id: string; text: string }>;
          };
          calls.push(payload.targets);
          return {
            statusCode: 200,
            headers: {},
            bodyText: JSON.stringify({
              choices: [
                {
                  finish_reason: "stop",
                  message: {
                    content: JSON.stringify({
                      translations: payload.targets.map((item) => ({
                        id: item.id,
                        text: `T:${item.text}`,
                      })),
                    }),
                  },
                },
              ],
            }),
          };
        },
      },
    );
    const request = makeProviderRequest();
    request.items.push(
      { id: "c3", text: "three" },
      { id: "c4", text: "four" },
      { id: "c5", text: "five" },
    );

    const result = await provider.attempt(request);
    expect(calls.map((items) => items.length)).toEqual([2, 2, 1]);
    expect(calls.flat().map((item) => item.text)).toEqual(["one", "two", "three", "four", "five"]);
    expect(result.translations).toHaveLength(5);
  });

  it("reuses one runtime session identity across tests and translation requests", async () => {
    const sessionHeaders: Array<string | undefined> = [];
    const provider = new OpenAICompatibleProvider(
      {
        endpoint: "https://example.test/v1",
        model: "model",
        capability: "json-object",
        sessionId: "profile-runtime-session",
      },
      {
        request: async (request) => {
          sessionHeaders.push(request.headers["X-Session-Id"]);
          const messages = (request.body as { messages: Array<{ content: string }> }).messages;
          const payload = JSON.parse(messages.at(-1)!.content) as {
            targets: Array<{ id: string; text: string }>;
          };
          return {
            statusCode: 200,
            headers: {},
            bodyText: JSON.stringify({
              choices: [
                {
                  finish_reason: "stop",
                  message: {
                    content: JSON.stringify({
                      translations: payload.targets.map((item) => ({
                        id: item.id,
                        text: `T:${item.text}`,
                      })),
                    }),
                  },
                },
              ],
            }),
          };
        },
      },
    );
    const request = makeProviderRequest();
    request.items.push(
      { id: "c3", text: "three" },
      { id: "c4", text: "four" },
      { id: "c5", text: "five" },
    );

    await provider.testConnection("test-one");
    await provider.attempt(request);
    await provider.testConnection("test-two");

    expect(sessionHeaders).toEqual(Array.from({ length: 5 }, () => "profile-runtime-session"));
  });

  it("keeps runtime session identities scoped to their provider instances", async () => {
    const headers: string[] = [];
    const transport: ProviderTransport = {
      request: async (request) => {
        headers.push(request.headers["X-Session-Id"]!);
        return {
          statusCode: 200,
          headers: {},
          bodyText: JSON.stringify({
            choices: [
              {
                finish_reason: "stop",
                message: { content: '{"translations":[{"id":"probe","text":"hola"}]}' },
              },
            ],
          }),
        };
      },
    };
    const first = new OpenAICompatibleProvider(
      {
        endpoint: "https://example.test/v1",
        model: "model",
        capability: "json-object",
        sessionId: "profile-session-one",
      },
      transport,
    );
    const second = new OpenAICompatibleProvider(
      {
        endpoint: "https://example.test/v1",
        model: "model",
        capability: "json-object",
        sessionId: "profile-session-two",
      },
      transport,
    );

    await first.testConnection("first-test");
    await second.testConnection("second-test");

    expect(headers).toEqual(["profile-session-one", "profile-session-two"]);
  });

  it("publishes each validated wire result with restored IDs before returning the aggregate", async () => {
    const provider = new OpenAICompatibleProvider(
      {
        endpoint: "https://example.test/v1",
        model: "model",
        capability: "json-object",
        sessionId: "session",
      },
      {
        request: async (request) => {
          const messages = (request.body as { messages: Array<{ content: string }> }).messages;
          const payload = JSON.parse(messages.at(-1)!.content) as {
            targets: Array<{ id: string; text: string }>;
          };
          return {
            statusCode: 200,
            headers: { "x-request-id": request.jobId },
            bodyText: JSON.stringify({
              choices: [
                {
                  finish_reason: "stop",
                  message: {
                    content: JSON.stringify({
                      translations: payload.targets.map((item) => ({
                        id: item.id,
                        text: `T:${item.text}`,
                      })),
                    }),
                  },
                },
              ],
            }),
          };
        },
      },
    );
    const request = makeProviderRequest();
    request.items = Array.from({ length: 5 }, (_, index) => ({
      id: `source-${index + 1}`,
      text: `text-${index + 1}`,
    }));
    const progress: Array<Array<{ id: string; text: string }>> = [];

    const result = await provider.attempt(request, (increment) => {
      progress.push(increment.translations);
    });

    expect(progress.map((items) => items.map((item) => item.id))).toEqual([
      ["source-1", "source-2"],
      ["source-3", "source-4"],
      ["source-5"],
    ]);
    expect(result.translations.map((item) => item.id)).toEqual([
      "source-1",
      "source-2",
      "source-3",
      "source-4",
      "source-5",
    ]);
  });

  it("does not publish invalid output or progress after cancellation", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let responseMode: "invalid" | "blocked" = "invalid";
    const provider = new OpenAICompatibleProvider(
      {
        endpoint: "https://example.test/v1",
        model: "model",
        capability: "prompt-json",
        sessionId: "session",
      },
      {
        request: async () => {
          if (responseMode === "blocked") await gate;
          return {
            statusCode: 200,
            headers: {},
            bodyText: JSON.stringify({
              choices: [
                {
                  finish_reason: "stop",
                  message: {
                    content:
                      responseMode === "invalid"
                        ? '{"translations":[{"id":"unknown","text":"x"}]}'
                        : '{"translations":[{"id":"c1","text":"one"},{"id":"c2","text":"two"}]}',
                  },
                },
              ],
            }),
          };
        },
        cancel: () => undefined,
      },
    );
    const progress: unknown[] = [];

    await expect(
      provider.attempt(makeProviderRequest(), (value) => progress.push(value)),
    ).resolves.toMatchObject({ translations: [] });
    responseMode = "blocked";
    const cancelled = provider.attempt(makeProviderRequest(), (value) => progress.push(value));
    await Promise.resolve();
    await provider.cancel("request");
    release();

    await expect(cancelled).rejects.toMatchObject({ category: "cancelled" });
    expect(progress).toEqual([]);
  });

  it("treats even a full chat-completions input as an API root", async () => {
    let requestedUrl = "";
    const provider = new OpenAICompatibleProvider(
      {
        endpoint: "https://example.test/v1/chat/completions",
        model: "model",
        capability: "prompt-json",
        sessionId: "session",
      },
      {
        request: async (request) => {
          requestedUrl = request.url;
          return {
            statusCode: 200,
            headers: {},
            bodyText: JSON.stringify({
              choices: [
                {
                  finish_reason: "stop",
                  message: { content: '{"translations":[{"id":"c1","text":"一"}]}' },
                },
              ],
            }),
          };
        },
      },
    );
    await provider.attempt(makeProviderRequest());
    expect(requestedUrl).toBe("https://example.test/v1/chat/completions/chat/completions");
  });

  it("does not hide authentication, model or quota failures behind capability fallback", async () => {
    for (const scenario of [
      {
        statusCode: 401,
        bodyText: JSON.stringify({ error: { code: "invalid_api_key", message: "private" } }),
        expected: {
          category: "authentication",
          providerCode: "invalid_api_key",
          userAction: "CHECK_CREDENTIALS",
        },
      },
      {
        statusCode: 400,
        bodyText: JSON.stringify({ error: { code: "model_not_found", message: "private" } }),
        expected: {
          category: "model",
          providerCode: "model_not_found",
          userAction: "CHECK_MODEL",
        },
      },
      {
        statusCode: 429,
        bodyText: JSON.stringify({ error: { code: "insufficient_quota", message: "private" } }),
        expected: {
          category: "quota",
          providerCode: "insufficient_quota",
          userAction: "CHECK_QUOTA",
        },
      },
    ] as const) {
      let calls = 0;
      const provider = new OpenAICompatibleProvider(
        {
          endpoint: "https://example.test/v1",
          model: "model",
          apiKey: "secret",
          sessionId: "session",
        },
        {
          request: async () => {
            calls += 1;
            return { statusCode: scenario.statusCode, headers: {}, bodyText: scenario.bodyText };
          },
        },
      );
      await expect(provider.probe()).rejects.toMatchObject({
        ...scenario.expected,
        retryable: false,
      });
      expect(calls).toBe(1);
      await expect(provider.probe()).rejects.not.toThrow(/private|secret/);
    }
  });

  it("performs a fresh capability-validating request for every connection test", async () => {
    const jobs: string[] = [];
    let statusCode = 200;
    const provider = new OpenAICompatibleProvider(
      {
        endpoint: "https://example.test/v1",
        model: "model",
        apiKey: "secret",
        capability: "json-object",
        sessionId: "session",
      },
      {
        request: async (request) => {
          jobs.push(request.jobId);
          if (statusCode === 429) {
            return {
              statusCode,
              headers: {},
              bodyText: JSON.stringify({
                error: { code: "insufficient_quota", message: "private provider detail" },
              }),
            };
          }
          return {
            statusCode,
            headers: {},
            bodyText: JSON.stringify({
              choices: [
                {
                  finish_reason: "stop",
                  message: { content: '{"translations":[{"id":"probe","text":"hola"}]}' },
                },
              ],
            }),
          };
        },
      },
    );

    await expect(provider.testConnection("test-a")).resolves.toBe("json-object");
    statusCode = 429;
    await expect(provider.testConnection("test-b")).rejects.toMatchObject({
      category: "quota",
      providerCode: "insufficient_quota",
      retryable: false,
    });
    await expect(provider.testConnection("test-c")).rejects.not.toThrow(
      /private provider detail|secret/,
    );
    expect(jobs).toEqual([
      "test-a-probe-json-object",
      "test-b-probe-json-object",
      "test-c-probe-json-object",
    ]);
  });

  it("does not fall back after a non-capability connection-test failure", async () => {
    const jobs: string[] = [];
    const provider = new OpenAICompatibleProvider(
      { endpoint: "https://example.test/v1", model: "model", sessionId: "session" },
      {
        request: async (request) => {
          jobs.push(request.jobId);
          return {
            statusCode: 429,
            headers: {},
            bodyText: JSON.stringify({ error: { code: "insufficient_quota" } }),
          };
        },
      },
    );

    await expect(provider.testConnection("test-current")).rejects.toMatchObject({
      category: "quota",
    });
    expect(jobs).toEqual(["test-current-probe-strict-json-schema"]);
  });

  it("classifies refusal, length/filter, quota and malformed output as permanent", async () => {
    for (const response of [
      { choices: [{ finish_reason: "content_filter", message: { content: "" } }] },
      { choices: [{ finish_reason: "length", message: { content: "{}" } }] },
      { choices: [{ finish_reason: "stop", message: { content: "not-json" } }] },
    ]) {
      const provider = new OpenAICompatibleProvider(
        {
          endpoint: "https://example.test/v1",
          model: "m",
          capability: "prompt-json",
          sessionId: "session",
        },
        {
          request: async () => ({
            statusCode: 200,
            headers: {},
            bodyText: JSON.stringify(response),
          }),
        },
      );
      await expect(provider.attempt(makeProviderRequest())).rejects.toMatchObject({
        retryable: false,
      });
    }
  });

  it.each(["system", "direct"] as const)(
    "uses a remote HTTP API root for Test and translation in %s mode",
    async (proxyMode) => {
      const calls: Array<{ url: string; proxyMode: string; authorization?: string }> = [];
      const provider = new OpenAICompatibleProvider(
        {
          endpoint: "http://api.example.test:8080/custom/root/",
          model: "model",
          apiKey: "key",
          capability: "json-object",
          proxyMode,
          sessionId: "session",
        },
        {
          request: async (request) => {
            calls.push({
              url: request.url,
              proxyMode: request.proxyMode,
              authorization: request.headers.Authorization,
            });
            const messages = (request.body as { messages: Array<{ content: string }> }).messages;
            const payload = JSON.parse(messages.at(-1)!.content) as {
              targets: Array<{ id: string; text: string }>;
            };
            return {
              statusCode: 200,
              headers: {},
              bodyText: JSON.stringify({
                choices: [
                  {
                    finish_reason: "stop",
                    message: {
                      content: JSON.stringify({
                        translations: payload.targets.map((target) => ({
                          id: target.id,
                          text: `T:${target.text}`,
                        })),
                      }),
                    },
                  },
                ],
              }),
            };
          },
        },
      );

      await expect(provider.testConnection(`test-${proxyMode}`)).resolves.toBe("json-object");
      await expect(provider.attempt(makeProviderRequest())).resolves.toMatchObject({
        translations: [{ id: "c1" }, { id: "c2" }],
      });
      expect(calls).toHaveLength(2);
      expect(calls).toEqual(
        calls.map(() => ({
          url: "http://api.example.test:8080/custom/root/chat/completions",
          proxyMode,
          authorization: "Bearer key",
        })),
      );
    },
  );
});
