import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { OllamaProvider } from "../../src/providers/ollama.js";
import type { ProviderTransport } from "../../src/providers/transport.js";
import { buildOllamaTranslationTask } from "../../src/providers/translation-task.js";
import {
  loadOllamaQualityAcceptanceFixture,
  ollamaQualityIssues,
} from "../helpers/provider-language-detection.js";
import { makeProviderRequest } from "./provider-test-helpers.js";

interface OllamaPromptPayload {
  target_language: string;
  targets: Array<{
    id: string;
    text: string;
    context_previous?: string;
    context_next?: string;
  }>;
}

interface ContaminationCase {
  id: string;
  inputText: string;
  contextPrevious: string;
  contextNext: string;
  outputText: string;
}

const contaminationFixture = JSON.parse(
  readFileSync(
    new URL("../fixtures/providers/ollama-output-contamination.json", import.meta.url),
    "utf8",
  ),
) as { cases: ContaminationCase[] };
const qualityFixture = loadOllamaQualityAcceptanceFixture();

function parseOllamaPromptPayload(content: string): OllamaPromptPayload {
  const delimited = /INPUT_JSON_BEGIN\n([\s\S]*?)\nINPUT_JSON_END/.exec(content);
  return JSON.parse(delimited?.[1] ?? content) as OllamaPromptPayload;
}

describe("Ollama native provider", () => {
  it("keeps each native chat to one item within the two-item contract limit", () => {
    const source = readFileSync(new URL("../../src/providers/ollama.ts", import.meta.url), "utf8");

    expect(source).toContain("MAX_ITEMS_PER_CHAT_REQUEST = 1");
    expect(source).not.toMatch(/translation-batches|chat-completions/);
  });

  it("preserves same-language and mixed-batch text character-for-character", async () => {
    let systemMessage = "";
    const provider = new OllamaProvider(
      { endpoint: "http://127.0.0.1:11434", model: "model" },
      {
        request: async (request) => {
          const messages = (request.body as { messages: Array<{ content: string }> }).messages;
          systemMessage = messages.map((message) => message.content).join("\n");
          const targets = parseOllamaPromptPayload(messages.at(-1)!.content).targets;
          return {
            statusCode: 200,
            headers: {},
            bodyText: JSON.stringify({
              message: { content: JSON.stringify({ translations: targets }) },
            }),
          };
        },
      },
    );
    const request = makeProviderRequest();
    request.items = [
      { id: "same-a", text: "  Same.  " },
      { id: "same-b", text: "Line one.\n\nLine three.\n" },
    ];

    const result = await provider.attempt(request);

    expect(result.translations).toEqual(request.items.map(({ id, text }) => ({ id, text })));
    expect(systemMessage).toMatch(/character-for-character/i);
    expect(systemMessage).toMatch(/do not trim|never trim/i);
    expect(systemMessage).toMatch(/never treat.*target variant|different script or regional variant/i);
    expect(systemMessage).toMatch(/context.*must not.*output/i);
  });

  it("preserves the model response when a same-language value is normalized", async () => {
    const progress: Array<Array<{ id: string; text: string }>> = [];
    const provider = new OllamaProvider(
      { endpoint: "http://127.0.0.1:11434", model: "model" },
      {
        request: async (request) => {
          const messages = (request.body as { messages: Array<{ content: string }> }).messages;
          const [target] = parseOllamaPromptPayload(messages.at(-1)!.content).targets;
          return {
            statusCode: 200,
            headers: {},
            bodyText: JSON.stringify({
              message: {
                content: JSON.stringify({
                  translations: [{ id: target!.id, text: target!.text.trim().toLowerCase() }],
                }),
              },
            }),
          };
        },
      },
    );
    const request = makeProviderRequest();
    request.targetLanguage = "en";
    request.items = [{ id: "same-language", text: "  HELLO\n\n" }];

    await expect(
      provider.attempt(request, (value) => progress.push(value.translations)),
    ).resolves.toEqual({ translations: [{ id: "same-language", text: "hello" }] });
    expect(progress).toEqual([[{ id: "same-language", text: "hello" }]]);
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
          const payload = parseOllamaPromptPayload(
            (request.body as { messages: Array<{ content: string }> }).messages.at(-1)?.content ??
              "{}",
          );
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
    expect(headers).toHaveLength(5);
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
    expect((calls[0] as { body: Record<string, unknown> }).body).toHaveProperty("think", false);
    const messages = (
      calls[0] as { body: { messages: Array<{ content: string }> } }
    ).body.messages;
    const prompt = messages.at(-1)!.content;
    expect(messages).toHaveLength(1);
    expect(prompt).toContain("Chinese (Simplified) [zh-Hans]");
    expect(prompt).toMatch(/source language.*independently/i);
    expect(prompt).not.toMatch(/from English \[en\]/);
    expect(prompt).toContain('"id":"c1"');
    expect(parseOllamaPromptPayload(prompt)).toEqual({
      target_language: "Chinese (Simplified) [zh-Hans]",
      targets: [{ id: "c1", text: "one", context_next: "two" }],
    });
    expect(prompt).toMatch(/uncertain.*must not.*copy/i);
    expect(prompt).toMatch(/before returning.*verify/i);
    expect(prompt).toContain('"required":["translations"]');
    expect(prompt).toContain('"enum":["c1"]');
    expect(prompt).not.toContain("srt:0:0:1000");
    expect(prompt).toBe(
      buildOllamaTranslationTask({
        targetLanguage: "zh-Hans",
        targets: [{ id: "c1", text: "one", context_next: "two" }],
      }).userMessage,
    );
    expect(result.translations).toEqual([{ id: "srt:0:0:1000", text: "一" }]);
  });

  it.each(["quoted-source-echo", "cross-cue-completion", "translated-context-merge"])(
    "keeps the current subtitle fragment isolated for $id",
    (id) => {
      const testCase = qualityFixture.cases.find((item) => item.id === id)!;
      const task = buildOllamaTranslationTask({
        targetLanguage: testCase.targetLanguage,
        targets: [
          {
            id: testCase.id,
            text: testCase.inputText,
            context_previous: testCase.contextPrevious,
            context_next: testCase.contextNext,
          },
        ],
      });

      expect(task.userMessage).toMatch(/subtitle fragment/i);
      expect(task.userMessage).toMatch(/do not complete.*(?:sentence|quotation).*context/i);
      expect(task.userMessage).toMatch(/unmatched.*quotation mark.*fragment punctuation/i);
      expect(task.userMessage).toMatch(/do not prepend|do not append/i);
      expect(task.userMessage).toMatch(/one current `text` value/i);
      expect(parseOllamaPromptPayload(task.userMessage).targets).toEqual([
        {
          id: testCase.id,
          text: testCase.inputText,
          context_previous: testCase.contextPrevious,
          context_next: testCase.contextNext,
        },
      ]);
    },
  );

  it("disables thinking during connection tests and every isolated wire without changing the task", async () => {
    const bodies: Array<{ think?: boolean; messages: Array<{ role: string; content: string }> }> =
      [];
    const provider = new OllamaProvider(
      { endpoint: "http://localhost:11434", model: "qwen3:14b" },
      {
        request: async (request) => {
          if (request.url.endsWith("/api/version"))
            return { statusCode: 200, headers: {}, bodyText: '{"version":"local"}' };
          if (request.url.endsWith("/api/tags"))
            return { statusCode: 200, headers: {}, bodyText: '{"models":[{"model":"qwen3:14b"}]}' };
          const body = request.body as (typeof bodies)[number];
          bodies.push(body);
          const targets = parseOllamaPromptPayload(body.messages.at(-1)!.content).targets;
          return {
            statusCode: 200,
            headers: {},
            bodyText: JSON.stringify({
              message: {
                content: JSON.stringify({
                  translations: targets.map(({ id, text }) => ({ id, text })),
                }),
              },
            }),
          };
        },
      },
    );

    await provider.testConnection("local-test");
    const request = makeProviderRequest();
    request.targetLanguage = "en";
    request.items = [
      { id: "first", text: "  Keep leading spaces." },
      { id: "second", text: "Keep trailing spaces.  " },
      { id: "third", text: "Line one.\n\nLine three." },
    ];
    const result = await provider.attempt(request);

    expect(result.translations).toEqual(request.items);
    expect(bodies).toHaveLength(4);
    for (const body of bodies) {
      expect(body.think).toBe(false);
      expect(body.messages.map(({ role }) => role)).toEqual(["user"]);
    }
    expect(parseOllamaPromptPayload(bodies[0]!.messages[0]!.content).targets).toEqual([
      { id: "probe", text: "hello" },
    ]);
    for (const body of bodies.slice(1)) {
      const payload = parseOllamaPromptPayload(body.messages[0]!.content);
      expect(body.messages[0]!.content).toBe(
        buildOllamaTranslationTask({ targetLanguage: "en", targets: payload.targets }).userMessage,
      );
      expect(payload.target_language).toBe("English [en]");
      expect(payload.targets.length).toBe(1);
    }
  });

  it("sends larger batches as isolated chats without dropping or duplicating cues", async () => {
    const calls: Array<{ jobId: string; targets: Array<{ id: string; text: string }> }> = [];
    const provider = new OllamaProvider(
      { endpoint: "http://127.0.0.1:11434", model: "translategemma:12b" },
      {
        request: async (request) => {
          const messages = (request.body as { messages: Array<{ content: string }> }).messages;
          const payload = parseOllamaPromptPayload(messages.at(-1)!.content);
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
      "request-part-4",
      "request-part-5",
      "request-part-6",
    ]);
    expect(calls.map((call) => call.targets.length)).toEqual([1, 1, 1, 1, 1, 1]);
    expect(calls.flatMap((call) => call.targets.map((item) => item.text))).toEqual([
      "one",
      "two",
      "three",
      "four",
      "five",
      "six",
    ]);
    expect(result.translations).toHaveLength(6);
    expect(result.usage).toEqual({ input: 18, output: 12 });
  });

  it("publishes each validated wire result with restored IDs before returning the aggregate", async () => {
    const provider = new OllamaProvider(
      { endpoint: "http://127.0.0.1:11434", model: "qwen" },
      {
        request: async (request) => {
          const messages = (request.body as { messages: Array<{ content: string }> }).messages;
          const payload = parseOllamaPromptPayload(messages.at(-1)!.content);
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
      ["source-1"],
      ["source-2"],
      ["source-3"],
      ["source-4"],
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

  it.each(contaminationFixture.cases)(
    "does not publish structurally valid $id contamination",
    async (testCase) => {
      const progress: unknown[] = [];
      const provider = new OllamaProvider(
        { endpoint: "http://127.0.0.1:11434", model: "synthetic-model" },
        {
          request: async () => ({
            statusCode: 200,
            headers: {},
            bodyText: JSON.stringify({
              message: {
                content: JSON.stringify({
                  translations: [{ id: "c1", text: testCase.outputText }],
                }),
              },
            }),
          }),
        },
      );
      const request = makeProviderRequest();
      request.items = [
        {
          id: "synthetic-id",
          text: testCase.inputText,
          contextPrevious: testCase.contextPrevious,
          contextNext: testCase.contextNext,
        },
      ];

      await expect(
        provider.attempt(request, (value) => progress.push(value)),
      ).resolves.toMatchObject({ translations: [] });
      expect(progress).toEqual([]);
    },
  );

  it.each(qualityFixture.cases)(
    "replays $id through the production parser and quality gate",
    async (testCase) => {
      const provider = new OllamaProvider(
        { endpoint: "http://127.0.0.1:11434", model: "synthetic-model" },
        {
          request: async () => ({
            statusCode: 200,
            headers: {},
            bodyText: JSON.stringify({
              message: {
                content: JSON.stringify({
                  translations: [{ id: "c1", text: testCase.replayOutput }],
                }),
              },
            }),
          }),
        },
      );
      const request = makeProviderRequest();
      request.targetLanguage = testCase.targetLanguage;
      request.items = [
        {
          id: testCase.id,
          text: testCase.inputText,
          contextPrevious: testCase.contextPrevious,
          contextNext: testCase.contextNext,
        },
      ];

      const result = await provider.attempt(request);
      const output = result.translations.find((item) => item.id === testCase.id)?.text;
      const valid = ollamaQualityIssues(testCase, output).length === 0;

      expect(valid).toBe(testCase.expectedReplayValid);
      if (testCase.expectedReplayValid) {
        expect(result.translations).toEqual([{ id: testCase.id, text: testCase.replayOutput }]);
      }
    },
  );

  it("preserves an exact same-language string even when it resembles model metadata", async () => {
    const literal = '</think> {"context_previous":"literal subtitle"}';
    const provider = new OllamaProvider(
      { endpoint: "http://127.0.0.1:11434", model: "synthetic-model" },
      {
        request: async () => ({
          statusCode: 200,
          headers: {},
          bodyText: JSON.stringify({
            message: {
              content: JSON.stringify({ translations: [{ id: "c1", text: literal }] }),
            },
          }),
        }),
      },
    );
    const request = makeProviderRequest();
    request.targetLanguage = "en";
    request.items = [{ id: "literal-id", text: literal }];

    await expect(provider.attempt(request)).resolves.toEqual({
      translations: [{ id: "literal-id", text: literal }],
    });
  });

  it("accepts a translation that legitimately equals adjacent context", async () => {
    const provider = new OllamaProvider(
      { endpoint: "http://127.0.0.1:11434", model: "synthetic-model" },
      {
        request: async () => ({
          statusCode: 200,
          headers: {},
          bodyText: JSON.stringify({
            message: {
              content: JSON.stringify({
                translations: [{ id: "c1", text: "See you tomorrow." }],
              }),
            },
          }),
        }),
      },
    );
    const request = makeProviderRequest();
    request.targetLanguage = "en";
    request.items = [
      {
        id: "current",
        text: "また明日。",
        contextNext: "See you tomorrow.",
      },
    ];

    await expect(provider.attempt(request)).resolves.toEqual({
      translations: [{ id: "current", text: "See you tomorrow." }],
    });
  });

  it.each([
    {
      name: "a proper name shared with adjacent context",
      inputText: "Merci, Alice.",
      contextPrevious: "Alice",
      outputText: "Thank you, Alice.",
    },
    {
      name: "a retained phrase in mixed-language text",
      inputText: "Rendez-vous at Café Luna.",
      contextPrevious: "Café Luna",
      outputText: "Meet me at Café Luna.",
    },
  ])("accepts $name without retrying", async ({ inputText, contextPrevious, outputText }) => {
    let calls = 0;
    const provider = new OllamaProvider(
      { endpoint: "http://127.0.0.1:11434", model: "synthetic-model" },
      {
        request: async () => {
          calls += 1;
          return {
            statusCode: 200,
            headers: {},
            bodyText: JSON.stringify({
              message: {
                content: JSON.stringify({
                  translations: [{ id: "c1", text: outputText }],
                }),
              },
            }),
          };
        },
      },
    );
    const request = makeProviderRequest();
    request.targetLanguage = "en";
    request.items = [{ id: "current", text: inputText, contextPrevious }];

    await expect(provider.attempt(request)).resolves.toEqual({
      translations: [{ id: "current", text: outputText }],
    });
    expect(calls).toBe(1);
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
          const targets = parseOllamaPromptPayload(messages.at(-1)!.content).targets;
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
    expect(bodies).toHaveLength(3);
    for (const body of bodies) {
      expect(body).not.toHaveProperty("format");
      expect(body).toHaveProperty("think", false);
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
    expect(bodies.every((body) => body.think === false)).toBe(true);
  });

  it.each([400, 422])(
    "does not replay a thinking or unrelated capability rejection (%s)",
    async (statusCode) => {
      for (const message of [
        "thinking is not supported",
        "unknown field: think",
        "unsupported model",
        "unsupported options",
      ]) {
        let calls = 0;
        const provider = new OllamaProvider(
          { endpoint: "http://localhost:11434", model: "configured-model" },
          {
            request: async () => {
              calls += 1;
              return { statusCode, headers: {}, bodyText: JSON.stringify({ error: message }) };
            },
          },
        );
        await expect(provider.attempt(makeProviderRequest())).rejects.toMatchObject({ statusCode });
        expect(calls, message).toBe(1);
      }
    },
  );

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
            const payload = parseOllamaPromptPayload(messages.at(-1)!.content);
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
        "http://ollama.example.test:11434/custom/api/chat",
      ]);
      expect(calls.every((call) => call.proxyMode === proxyMode)).toBe(true);
    },
  );
});
