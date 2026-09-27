import { describe, expect, it } from "vitest";
import type { ConfiguredProvider } from "../../src/providers/provider.js";
import type { ProviderTransport, ProviderTransportRequest } from "../../src/providers/transport.js";
import { makeProviderRequest } from "../contract/provider-test-helpers.js";

export type FailureKind = "openai" | "deepseek" | "claude" | "ollama";
export function endingResponse(kind: FailureKind, ids: string[], signal: string, valid = true) {
  const content = valid
    ? JSON.stringify({ translations: ids.map((id) => ({ id, text: "result" })) })
    : "invalid private output";
  const refusal = signal === "refusal" || signal === "both";
  const ending =
    signal === "both" || signal === "length"
      ? kind === "claude"
        ? "max_tokens"
        : "length"
      : signal === "unknown"
        ? "tool_calls"
        : undefined;
  if (kind === "claude")
    return {
      type: "message",
      role: "assistant",
      ...(ending ? { stop_reason: ending } : {}),
      ...(refusal ? { stop_details: { type: "refusal" } } : {}),
      content: [{ type: "text", text: content }],
    };
  const message = { content, ...(refusal ? { refusal: "private refusal" } : {}) };
  return kind === "ollama"
    ? { message, ...(ending ? { done_reason: ending } : {}) }
    : { choices: [{ message, ...(ending ? { finish_reason: ending } : {}) }] };
}
export function failureTransport(
  kind: FailureKind,
  signal: string,
  valid: boolean,
  calls: ProviderTransportRequest[],
): ProviderTransport {
  return {
    request: async (request) => {
      calls.push(request);
      let body: unknown;
      if (request.url.endsWith("/api/version")) body = { version: "fixture" };
      else if (request.url.endsWith("/api/tags")) body = { models: [{ model: "model" }] };
      else {
        const messages = (request.body as { messages: Array<{ content: string }> }).messages;
        const targets = (
          JSON.parse(
            kind === "ollama"
              ? messages
                  .at(-1)!
                  .content.split("INPUT_JSON_BEGIN\n")[1]!
                  .split("\nINPUT_JSON_END")[0]!
              : messages.at(-1)!.content,
          ) as { targets: Array<{ id: string }> }
        ).targets;
        body = endingResponse(
          kind,
          targets.map((target) => target.id),
          signal,
          valid,
        );
      }
      return { statusCode: 200, headers: {}, bodyText: JSON.stringify(body) };
    },
  };
}
export function registerFailureContract(
  kind: FailureKind,
  create: (transport: ProviderTransport) => ConfiguredProvider,
) {
  describe(`${kind} completion signals`, () => {
    for (const operation of ["test", "translation"] as const) {
      it.each([
        ["length", true, "protocol"],
        ["length", false, "protocol"],
        ["refusal", false, "refusal"],
        ["both", true, "refusal"],
        ["both", false, "refusal"],
        ["unknown", true, "protocol"],
        ["missing", true, null],
        ["missing", false, "protocol"],
      ] as const)(
        `${operation} handles %s with readable output=%s`,
        async (signal, valid, category) => {
          const calls: ProviderTransportRequest[] = [];
          const provider = create(failureTransport(kind, signal, valid, calls));
          const request = makeProviderRequest();
          request.items = request.items.slice(0, 1);
          const work =
            operation === "test" ? provider.testConnection("test") : provider.attempt(request);
          if (category) await expect(work).rejects.toMatchObject({ category, retryable: false });
          else await expect(work).resolves.toBeDefined();
          expect(calls.filter((call) => call.method === "POST")).toHaveLength(1);
        },
      );
    }
  });
}
