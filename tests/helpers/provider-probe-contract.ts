import { describe, expect, it } from "vitest";
import type { ConfiguredProvider } from "../../src/providers/provider.js";
import type { ProviderTransport, ProviderTransportRequest } from "../../src/providers/transport.js";

export function registerProbeContract(
  kind: "openai" | "claude" | "deepseek" | "ollama",
  create: (transport: ProviderTransport) => ConfiguredProvider,
) {
  const id = kind === "claude" ? "c1" : "probe";
  const target = { id, text: "hola" };
  const scenarios: Array<[string, unknown, boolean]> = [
    ["valid", { translations: [target] }, true],
    ["same input", { translations: [{ id, text: "hello" }] }, true],
    ["preserved whitespace", { translations: [{ id, text: "  hola  " }] }, true],
    ["empty", { translations: [] }, false],
    ["missing", {}, false],
    ["duplicate", { translations: [target, target] }, false],
    ["unknown", { translations: [{ id: "unknown", text: "hola" }] }, false],
    ["valid plus unknown", { translations: [target, { id: "unknown", text: "hola" }] }, false],
    ["blank", { translations: [{ id, text: " \n " }] }, false],
    ["nonstring", { translations: [{ id, text: 3 }] }, false],
    ["unreadable", "not JSON", false],
  ];
  if (kind === "ollama")
    scenarios.push([
      "filtered contamination",
      { translations: [{ id, text: "Translation: hola" }] },
      false,
    ]);
  describe(`${kind} complete fixed Test probe`, () => {
    it.each(scenarios)("validates %s before any lossy filtering", async (_name, output, ok) => {
      const calls: ProviderTransportRequest[] = [];
      const provider = create({
        request: async (request) => {
          calls.push(request);
          let body: unknown;
          if (request.url.endsWith("/api/version")) body = { version: "fixture" };
          else if (request.url.endsWith("/api/tags")) body = { models: [{ model: "model" }] };
          else {
            const content = typeof output === "string" ? output : JSON.stringify(output);
            body =
              kind === "claude"
                ? {
                    type: "message",
                    role: "assistant",
                    stop_reason: "end_turn",
                    content: [{ type: "text", text: content }],
                  }
                : kind === "ollama"
                  ? { message: { content } }
                  : { choices: [{ finish_reason: "stop", message: { content } }] };
          }
          return { statusCode: 200, headers: {}, bodyText: JSON.stringify(body) };
        },
      });
      if (ok) await expect(provider.testConnection("fixed-test")).resolves.toBeDefined();
      else
        await expect(provider.testConnection("fixed-test")).rejects.toMatchObject({
          category: "protocol",
          retryable: false,
        });
      expect(calls.filter((call) => call.method === "POST")).toHaveLength(1);
      expect(JSON.stringify(calls)).not.toContain("currently-playing-private-subtitle");
    });
    it("does not turn a previous successful capability into a new Test result", async () => {
      let posts = 0;
      const provider = create({
        request: async (request) => {
          const output = { translations: ++posts === 1 ? [target] : [] };
          let body: unknown;
          if (request.url.endsWith("/api/version")) {
            posts--;
            body = { version: "fixture" };
          } else if (request.url.endsWith("/api/tags")) {
            posts--;
            body = { models: [{ model: "model" }] };
          } else {
            const content = JSON.stringify(output);
            body =
              kind === "claude"
                ? {
                    type: "message",
                    role: "assistant",
                    stop_reason: "end_turn",
                    content: [{ type: "text", text: content }],
                  }
                : kind === "ollama"
                  ? { message: { content } }
                  : { choices: [{ finish_reason: "stop", message: { content } }] };
          }
          return { statusCode: 200, headers: {}, bodyText: JSON.stringify(body) };
        },
      });
      await provider.testConnection("first");
      await expect(provider.testConnection("second")).rejects.toMatchObject({
        category: "protocol",
      });
      expect(posts).toBe(2);
    });
  });
}
