import { beforeAll, expect, it } from "vitest";
import { createLocalizer } from "../../ui/localization.js";
import { OpenAICompatibleProvider } from "../../src/providers/openai.js";
import { DeepSeekProvider } from "../../src/providers/deepseek.js";
import { ClaudeProvider } from "../../src/providers/claude.js";
import { OllamaProvider } from "../../src/providers/ollama.js";
import { normalizeProviderError } from "../../src/domain/errors.js";
import { failureTransport } from "../helpers/provider-failure-contract.js";
import type { ProviderTransportRequest } from "../../src/providers/transport.js";
import { makeProviderRequest } from "../contract/provider-test-helpers.js";

const localizer = createLocalizer("en");
beforeAll(async () => {
  await import("../../ui/service-failure-message.js");
  await import("../../ui/provider-status.js");
  await import("../../ui/session-status.js");
});
for (const kind of ["openai", "deepseek", "claude", "ollama"] as const) {
  for (const operation of ["test", "translation"] as const) {
    it.each(["length", "refusal", "both"])(
      `${kind} ${operation} maps %s to exact public feedback`,
      async (signal) => {
        const calls: ProviderTransportRequest[] = [];
        const transport = failureTransport(kind, signal, true, calls);
        const config = {
          endpoint: "https://private.example",
          model: "model",
          apiKey: "private-key",
        };
        const provider =
          kind === "openai"
            ? new OpenAICompatibleProvider(
                { ...config, sessionId: "test", capability: "strict-json-schema" },
                transport,
              )
            : kind === "deepseek"
              ? new DeepSeekProvider(config, transport)
              : kind === "claude"
                ? new ClaudeProvider(config, transport)
                : new OllamaProvider(config, transport);
        const request = makeProviderRequest();
        request.items = [{ id: "target", text: "private-subtitle" }];
        let caught: unknown;
        try {
          if (operation === "test") await provider.testConnection("test");
          else await provider.attempt(request);
        } catch (error) {
          caught = error;
        }
        expect(caught).toBeDefined();
        const safe = normalizeProviderError(caught);
        const messageKey =
          signal === "length"
            ? "sidebar.theTranslationServiceReturnedAnUnsupportedResponse"
            : "sidebar.theTranslationServiceRefusedThisRequestTry";
        const testFeedback = globalThis.subtandemProviderTestStatusFeedback({ ...safe, ok: false });
        const sessionFeedback = globalThis.subtandemSessionFailureFeedback(safe);
        for (const feedback of [testFeedback, sessionFeedback]) {
          expect(feedback).toEqual({ messageKey, params: {} });
          expect(globalThis.subtandemLocalization.feedback(feedback)).toBe(
            localizer.format(messageKey),
          );
        }
        expect(JSON.stringify(safe)).not.toMatch(/private-|private\.example/);
        expect(calls.filter((call) => call.method === "POST")).toHaveLength(1);
      },
    );
  }
}
