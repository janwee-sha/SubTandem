import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { OllamaProvider } from "../../src/providers/ollama.js";
import type { ProviderTransport } from "../../src/providers/transport.js";
import { buildTranslationTask } from "../../src/providers/translation-task.js";
import { makeProviderRequest } from "./provider-test-helpers.js";

describe("Ollama native provider", () => {
  it("retains its native two-item chat batching after the shared helper rename", () => {
    const source = readFileSync(new URL("../../src/providers/ollama.ts", import.meta.url), "utf8");

    expect(source).toContain("MAX_ITEMS_PER_CHAT_REQUEST = 2");
    expect(source).not.toMatch(/translation-batches|chat-completions/);
  });

  it("uses the same optional Bearer for version, tags and chat", async () => {
    const headers: Array<Record<string, string>> = [];
    const provider = new OllamaProvider(
      { endpoint: "https://ollama.example.test", model: "qwen", apiKey: "remote-secret" },
      {
        request: async (request) => {
          headers.push(request.headers);
          if (request.url.endsWith("/api/version"))
            return { statusCode: 200, headers: {}, bodyText: '{"version":"0.10"}' };
          if (request.url.endsWith("/api/tags"))
            return { statusCode: 200, headers: {}, bodyText: '{"models":[{"model":"qwen"}]}' };
          const payload = JSON.parse(
            (request.body as { messages: Array<{ content: string }> }).messages.at(-1)?.content ??
              "{}",
          ) as { targets?: Array<{ id: string }> };
          return {
            statusCode: 200,
            headers: {},
            bodyText: JSON.stringify({
              message: {
                content: JSON.stringify({
                  translations: (payload.targets ?? []).map((item) => ({ id: item.id, text: "T" })),
                }),
              },
            }),
          };
        },
      },
    );
    await provider.testConnection("authenticated-test");
    await provider.attempt(makeProviderRequest());
    expect(headers).toHaveLength(4);
    expect(headers.every((value) => value.Authorization === "Bearer remote-secret")).toBe(true);
  });

  it("probes version/tags/schema and diagnoses missing model", async () => {
    const paths: string[] = [];
    const transport: ProviderTransport = {
      request: async (request) => {
        paths.push(new URL(request.url).pathname);
        if (request.url.endsWith("/api/version"))
          return { statusCode: 200, headers: {}, bodyText: '{"version":"0.10"}' };
        if (request.url.endsWith("/api/tags"))
          return {
            statusCode: 200,
            headers: {},
            bodyText: '{"models":[{"model":" ","name":"qwen"}]}',
          };
        return {
          statusCode: 200,
          headers: {},
          bodyText:
            '{"message":{"content":"{\\"translations\\":[{\\"id\\":\\"probe\\",\\"text\\":\\"hola\\"}]}"}}',
        };
      },
    };
    const provider = new OllamaProvider(
      { endpoint: "http://127.0.0.1:11434", model: "qwen" },
      transport,
    );
    await expect(provider.probe()).resolves.toMatchObject({ version: "0.10", model: "qwen" });
    expect(paths).toEqual(["/api/version", "/api/tags", "/api/chat"]);
    const missing = new OllamaProvider(
      { endpoint: "http://127.0.0.1:11434", model: "missing" },
      transport,
    );
    await expect(missing.probe()).rejects.toMatchObject({ category: "model", retryable: false });
  });

  it("uses non-stream structured chat, temperature 0 and cold-start timeout", async () => {
    const calls: unknown[] = [];
    const provider = new OllamaProvider(
      { endpoint: "http://localhost:11434/", model: "qwen" },
      {
        request: async (request) => {
          calls.push(request);
          return {
            statusCode: 200,
            headers: {},
            bodyText:
              '{"message":{"content":"{\\"translations\\":[{\\"id\\":\\"c1\\",\\"text\\":\\"一\\"}]}"},"prompt_eval_count":5,"eval_count":2}',
          };
        },
      },
    );
    const request = makeProviderRequest();
    request.items[0]!.id = "srt:0:0:1000";
    request.items[1]!.id = "srt:1:1000:2000";
    const result = await provider.attempt(request);
    expect(calls[0]).toMatchObject({
      url: "http://localhost:11434/api/chat",
      timeoutMs: 60_000,
      body: { stream: false, options: { temperature: 0 } },
    });
    expect((calls[0] as { body: Record<string, unknown> }).body).not.toHaveProperty("think");
    const userMessage = (
      calls[0] as { body: { messages: Array<{ content: string }> } }
    ).body.messages.at(-1)?.content;
    const systemMessage = (calls[0] as { body: { messages: Array<{ content: string }> } }).body
      .messages[0]?.content;
    expect(systemMessage).toContain("English [en]");
    expect(systemMessage).toContain("Chinese (Simplified) [zh-Hans]");
    expect(userMessage).toContain('"id":"c1"');
    expect(JSON.parse(userMessage!)).toEqual({
      targets: [
        { id: "c1", text: "one", context_next: "two" },
        { id: "c2", text: "two", context_previous: "one" },
      ],
    });
    expect(userMessage).not.toContain("srt:0:0:1000");
    expect(systemMessage).toBe(
      buildTranslationTask({
        sourceLanguage: "en",
        targetLanguage: "zh-Hans",
        targets: [
          { id: "c1", text: "one", context_next: "two" },
          { id: "c2", text: "two", context_previous: "one" },
        ],
      }).systemMessage,
    );
    expect(result.translations).toEqual([{ id: "srt:0:0:1000", text: "一" }]);
  });

  it("sends larger batches as two-item chats without dropping or duplicating cues", async () => {
    const calls: Array<{ jobId: string; targets: Array<{ id: string; text: string }> }> = [];
    const provider = new OllamaProvider(
      { endpoint: "http://127.0.0.1:11434", model: "translategemma:12b" },
      {
        request: async (request) => {
          const messages = (request.body as { messages: Array<{ content: string }> }).messages;
          const payload = JSON.parse(messages.at(-1)!.content) as {
            targets: Array<{ id: string; text: string }>;
          };
          calls.push({ jobId: request.jobId, targets: payload.targets });
          return {
            statusCode: 200,
            headers: {},
            bodyText: JSON.stringify({
              message: {
                content: JSON.stringify({
                  translations: payload.targets.map((item) => ({
                    id: item.id,
                    text: `T:${item.text}`,
                  })),
                }),
              },
              prompt_eval_count: 3,
              eval_count: 2,
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
      { id: "c6", text: "six" },
    );

    const result = await provider.attempt(request);

    expect(calls.map((call) => call.jobId)).toEqual([
      "request-part-1",
      "request-part-2",
      "request-part-3",
    ]);
    expect(calls.map((call) => call.targets.length)).toEqual([2, 2, 2]);
    expect(calls.flatMap((call) => call.targets.map((item) => item.text))).toEqual([
      "one",
      "two",
      "three",
      "four",
      "five",
      "six",
    ]);
    expect(result.translations).toHaveLength(6);
    expect(result.usage).toEqual({ input: 9, output: 6 });
  });

  it("publishes each validated wire result with restored IDs before returning the aggregate", async () => {
    const provider = new OllamaProvider(
      { endpoint: "http://127.0.0.1:11434", model: "qwen" },
      {
        request: async (request) => {
          const messages = (request.body as { messages: Array<{ content: string }> }).messages;
          const payload = JSON.parse(messages.at(-1)!.content) as {
            targets: Array<{ id: string; text: string }>;
          };
          return {
            statusCode: 200,
            headers: {},
            bodyText: JSON.stringify({
              message: {
                content: JSON.stringify({
                  translations: payload.targets.map((item) => ({
                    id: item.id,
                    text: `T:${item.text}`,
                  })),
                }),
              },
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

  it("does not publish invalid output", async () => {
    const progress: unknown[] = [];
    const provider = new OllamaProvider(
      { endpoint: "http://127.0.0.1:11434", model: "qwen" },
      {
        request: async () => ({
          statusCode: 200,
          headers: {},
          bodyText:
            '{"message":{"content":"{\\"translations\\":[{\\"id\\":\\"unknown\\",\\"text\\":\\"x\\"}]}"}}',
        }),
      },
    );

    await expect(
      provider.attempt(makeProviderRequest(), (value) => progress.push(value)),
    ).resolves.toMatchObject({ translations: [] });
    expect(progress).toEqual([]);
  });

  it("uses prompt-only JSON for Ollama Cloud and accepts one complete JSON code block", async () => {
    const bodies: Array<Record<string, unknown>> = [];
    const provider = new OllamaProvider(
      { endpoint: "https://ollama.com", model: "cloud-model", apiKey: "cloud-secret" },
      {
        request: async (request) => {
          if (request.url.endsWith("/api/version"))
            return { statusCode: 200, headers: {}, bodyText: '{"version":"cloud"}' };
          if (request.url.endsWith("/api/tags"))
            return {
              statusCode: 200,
              headers: {},
              bodyText: '{"models":[{"model":"cloud-model"}]}',
            };
          bodies.push(request.body as Record<string, unknown>);
          const messages = (request.body as { messages: Array<{ content: string }> }).messages;
          const targets = JSON.parse(messages.at(-1)!.content).targets as Array<{ id: string }>;
          const hasExactSchema =
            messages[0]!.content.includes('"required":["translations"]') &&
            targets.every((target) => messages[0]!.content.includes(`"${target.id}"`));
          return {
            statusCode: 200,
            headers: {},
            bodyText: JSON.stringify({
              message: {
                content: hasExactSchema
                  ? `\`\`\`json\n${JSON.stringify({
                      translations: targets.map((target) => ({ id: target.id, text: "T" })),
                    })}\n\`\`\``
                  : JSON.stringify(Object.fromEntries(targets.map((target) => [target.id, "T"]))),
              },
            }),
          };
        },
      },
    );

    await expect(provider.testConnection("cloud-test")).resolves.toMatchObject({
      model: "cloud-model",
    });
    await expect(provider.attempt(makeProviderRequest())).resolves.toMatchObject({
      translations: [{ id: "c1" }, { id: "c2" }],
    });
    expect(bodies).toHaveLength(2);
    for (const body of bodies) {
      expect(body).not.toHaveProperty("format");
      expect(body).not.toHaveProperty("think");
      const messages = body.messages as Array<{ content: string }>;
      expect(messages[0]!.content).toContain('"additionalProperties":false');
      expect(messages[0]!.content).toContain('"required":["translations"]');
    }
  });

  it("falls back from rejected JSON Schema without retrying unrelated request failures", async () => {
    const bodies: Array<Record<string, unknown>> = [];
    const provider = new OllamaProvider(
      { endpoint: "https://remote-ollama.example.test", model: "remote-model" },
      {
        request: async (request) => {
          if (request.url.endsWith("/api/version"))
            return { statusCode: 200, headers: {}, bodyText: '{"version":"remote"}' };
          if (request.url.endsWith("/api/tags"))
            return {
              statusCode: 200,
              headers: {},
              bodyText: '{"models":[{"model":"remote-model"}]}',
            };
          const body = request.body as Record<string, unknown>;
          bodies.push(body);
          if ("format" in body)
            return {
              statusCode: 400,
              headers: {},
              bodyText: '{"error":"structured output is not supported"}',
            };
          return {
            statusCode: 200,
            headers: {},
            bodyText:
              '{"message":{"content":"{\\"translations\\":[{\\"id\\":\\"probe\\",\\"text\\":\\"hola\\"}]}"}}',
          };
        },
      },
    );

    await expect(provider.testConnection("fallback-test")).resolves.toMatchObject({
      model: "remote-model",
    });
    expect(bodies).toHaveLength(2);
    expect(bodies[0]).toHaveProperty("format");
    expect(bodies[1]).not.toHaveProperty("format");
    expect(bodies.every((body) => !("think" in body))).toBe(true);
  });

  it("does not retry a non-capability request rejection", async () => {
    let chatCalls = 0;
    const provider = new OllamaProvider(
      { endpoint: "https://remote-ollama.example.test", model: "missing-model" },
      {
        request: async (request) => {
          if (request.url.endsWith("/api/version"))
            return { statusCode: 200, headers: {}, bodyText: '{"version":"remote"}' };
          if (request.url.endsWith("/api/tags"))
            return {
              statusCode: 200,
              headers: {},
              bodyText: '{"models":[{"model":"missing-model"}]}',
            };
          chatCalls += 1;
          return { statusCode: 400, headers: {}, bodyText: '{"error":"invalid model"}' };
        },
      },
    );

    await expect(provider.testConnection("rejected-test")).rejects.toMatchObject({
      statusCode: 400,
    });
    expect(chatCalls).toBe(1);
  });

  it("rejects natural-language wrappers around an otherwise valid JSON object", async () => {
    const provider = new OllamaProvider(
      { endpoint: "https://ollama.com", model: "cloud-model" },
      {
        request: async () => ({
          statusCode: 200,
          headers: {},
          bodyText:
            '{"message":{"content":"Here is the result: {\\"translations\\":[{\\"id\\":\\"c1\\",\\"text\\":\\"T\\"}]}"}}',
        }),
      },
    );

    await expect(provider.attempt(makeProviderRequest())).rejects.toMatchObject({
      category: "protocol",
    });
  });

  it("cancels every active split chat for the logical batch", async () => {
    const cancelled: string[] = [];
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const provider = new OllamaProvider(
      { endpoint: "http://127.0.0.1:11434", model: "qwen" },
      {
        request: async () => {
          await gate;
          return {
            statusCode: 200,
            headers: {},
            bodyText: JSON.stringify({
              message: { content: '{"translations":[{"id":"c1","text":"一"}]}' },
            }),
          };
        },
        cancel: (jobId) => {
          cancelled.push(jobId);
        },
      },
    );
    const progress: unknown[] = [];
    const attempt = provider.attempt(makeProviderRequest(), (value) => progress.push(value));
    await Promise.resolve();

    await provider.cancel("request");
    release?.();
    await expect(attempt).rejects.toMatchObject({ category: "cancelled" });

    expect(cancelled).toEqual(["request-part-1"]);
    expect(progress).toEqual([]);
  });

  it("rechecks service, model and structured output for every connection test", async () => {
    const jobs: string[] = [];
    const provider = new OllamaProvider(
      { endpoint: "http://127.0.0.1:11434", model: "qwen" },
      {
        request: async (request) => {
          jobs.push(request.jobId);
          if (request.url.endsWith("/api/version"))
            return { statusCode: 200, headers: {}, bodyText: '{"version":"0.10"}' };
          if (request.url.endsWith("/api/tags"))
            return {
              statusCode: 200,
              headers: {},
              bodyText: '{"models":[{"name":"qwen"}]}',
            };
          return {
            statusCode: 200,
            headers: {},
            bodyText:
              '{"message":{"content":"{\\"translations\\":[{\\"id\\":\\"probe\\",\\"text\\":\\"hola\\"}]}"}}',
          };
        },
      },
    );

    await expect(provider.testConnection("test-a")).resolves.toMatchObject({ model: "qwen" });
    await expect(provider.testConnection("test-b")).resolves.toMatchObject({ model: "qwen" });
    expect(jobs).toEqual([
      "test-a-version",
      "test-a-tags",
      "test-a-schema",
      "test-b-version",
      "test-b-tags",
      "test-b-schema",
    ]);
  });

  it("cancels only the matching connection-test jobs", async () => {
    const cancelled: string[] = [];
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const provider = new OllamaProvider(
      { endpoint: "http://127.0.0.1:11434", model: "qwen" },
      {
        request: async (request) => {
          await gate;
          if (request.url.endsWith("/api/version"))
            return { statusCode: 200, headers: {}, bodyText: '{"version":"0.10"}' };
          if (request.url.endsWith("/api/tags"))
            return {
              statusCode: 200,
              headers: {},
              bodyText: '{"models":[{"name":"qwen"}]}',
            };
          return {
            statusCode: 200,
            headers: {},
            bodyText:
              '{"message":{"content":"{\\"translations\\":[{\\"id\\":\\"probe\\",\\"text\\":\\"hola\\"}]}"}}',
          };
        },
        cancel: (jobId) => {
          cancelled.push(jobId);
        },
      },
    );
    const first = provider.testConnection("test-a");
    const second = provider.testConnection("test-b");
    await Promise.resolve();

    await provider.cancel("test-a");
    release();

    await expect(first).rejects.toMatchObject({ category: "cancelled" });
    await expect(second).resolves.toMatchObject({ model: "qwen" });
    expect(cancelled).toEqual(["test-a-version"]);
  });

  it.each(["system", "direct"] as const)(
    "uses a complete remote HTTP endpoint for probe, Test and translation in %s mode",
    async (proxyMode) => {
      const calls: Array<{ url: string; proxyMode: string }> = [];
      const provider = new OllamaProvider(
        {
          endpoint: "http://ollama.example.test:11434/custom/",
          model: "qwen",
          proxyMode,
        },
        {
          request: async (request) => {
            calls.push({ url: request.url, proxyMode: request.proxyMode });
            if (request.url.endsWith("/api/version"))
              return { statusCode: 200, headers: {}, bodyText: '{"version":"0.10"}' };
            if (request.url.endsWith("/api/tags"))
              return {
                statusCode: 200,
                headers: {},
                bodyText: '{"models":[{"name":"qwen"}]}',
              };
            const messages = (request.body as { messages: Array<{ content: string }> }).messages;
            const payload = JSON.parse(messages.at(-1)!.content) as {
              targets: Array<{ id: string; text: string }>;
            };
            return {
              statusCode: 200,
              headers: {},
              bodyText: JSON.stringify({
                message: {
                  content: JSON.stringify({
                    translations: payload.targets.map((target) => ({
                      id: target.id,
                      text: `T:${target.text}`,
                    })),
                  }),
                },
              }),
            };
          },
        },
      );

      await expect(provider.probe()).resolves.toMatchObject({ model: "qwen" });
      await expect(provider.testConnection(`test-${proxyMode}`)).resolves.toMatchObject({
        model: "qwen",
      });
      await expect(provider.attempt(makeProviderRequest())).resolves.toMatchObject({
        translations: [{ id: "c1" }, { id: "c2" }],
      });
      expect(calls.map((call) => call.url)).toEqual([
        "http://ollama.example.test:11434/custom/api/version",
        "http://ollama.example.test:11434/custom/api/tags",
        "http://ollama.example.test:11434/custom/api/chat",
        "http://ollama.example.test:11434/custom/api/version",
        "http://ollama.example.test:11434/custom/api/tags",
        "http://ollama.example.test:11434/custom/api/chat",
        "http://ollama.example.test:11434/custom/api/chat",
      ]);
      expect(calls.every((call) => call.proxyMode === proxyMode)).toBe(true);
    },
  );
});
