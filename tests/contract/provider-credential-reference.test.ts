import { describe, expect, it } from "vitest";
import { OpenAICompatibleProvider } from "../../src/providers/openai.js";
import { ClaudeProvider } from "../../src/providers/claude.js";
import { DeepSeekProvider } from "../../src/providers/deepseek.js";
import { OllamaProvider } from "../../src/providers/ollama.js";
import { discoverProviderModels } from "../../src/providers/model-discovery.js";
import type { ProviderTransportRequest } from "../../src/providers/transport.js";

const constructors = {
  openai: OpenAICompatibleProvider,
  claude: ClaudeProvider,
  deepseek: DeepSeekProvider,
  ollama: OllamaProvider,
};
const profileId = "10000000-0000-4000-8000-000000000001";

describe("provider native credential references", () => {
  it.each(["openai", "claude", "deepseek", "ollama"] as const)(
    "keeps %s authentication out of JS requests and configurations",
    async (kind) => {
      const credential = {
        source: "saved" as const,
        profileId,
        profileRevision: 3,
        kind,
        endpointFingerprint: "fingerprint",
      };
      const requests: ProviderTransportRequest[] = [];
      const transport = {
        request: async (request: ProviderTransportRequest) => {
          requests.push(request);
          throw new Error("synthetic-stop-before-network");
        },
      };
      const endpoint =
        kind === "openai" || kind === "deepseek"
          ? "https://example.test/v1"
          : "https://example.test";
      const config = {
        endpoint,
        model: "model",
        sessionId: "session",
        credential,
        senderId: "real-window",
      };
      const provider = new constructors[kind](config, transport);
      await expect(provider.testConnection("request-1")).rejects.toThrow();
      await expect(
        discoverProviderModels(
          {
            jobId: "models-job",
            kind,
            endpoint,
            model: "model",
            credential,
            owner: { senderId: "real-window", requestId: "request-2" },
          },
          transport,
        ),
      ).rejects.toThrow();
      expect(requests).toHaveLength(2);
      for (const request of requests) {
        expect(request.credential).toEqual(credential);
        expect(request.owner.senderId).toBe("real-window");
        expect(request.provider).toEqual({ kind, endpoint, model: "model", proxyMode: "system" });
        expect(Object.keys(request.headers).map((name) => name.toLowerCase())).not.toContain(
          "authorization",
        );
        expect(Object.keys(request.headers).map((name) => name.toLowerCase())).not.toContain(
          "x-api-key",
        );
        expect(JSON.stringify(request)).not.toContain("apiKey");
      }
      expect(requests.map((request) => request.purpose)).toEqual(["test", "models"]);
    },
  );
});
