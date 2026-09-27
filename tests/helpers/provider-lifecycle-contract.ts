import { describe, expect, it } from "vitest";
import type { ConfiguredProvider } from "../../src/providers/provider.js";
import type { ProviderTransport } from "../../src/providers/transport.js";
import { CompletionQueue } from "./profile-activation-harness.js";
import { failureTransport, type FailureKind } from "./provider-failure-contract.js";
import { makeProviderRequest } from "../contract/provider-test-helpers.js";

export function registerLifecycleContract(
  kind: FailureKind,
  create: (transport: ProviderTransport) => ConfiguredProvider,
) {
  describe(`${kind} exact request lifetime`, () => {
    it("cancels only owned jobs and ignores a late cancellation after cleanup", async () => {
      const queue = new CompletionQueue<string, void>();
      const cancelled: string[] = [];
      const requests: string[] = [];
      const valid = failureTransport(kind, "missing", true, []);
      const provider = create({
        request: async (request) => {
          requests.push(request.jobId);
          await queue.hold(request.jobId).promise;
          return valid.request(request);
        },
        cancel: (jobId) => {
          cancelled.push(jobId);
          throw new Error("cancel failed");
        },
      });
      const old = provider.testConnection("scope").catch((error) => error);
      const next = provider.testConnection("scope-next");
      await queue.waitForPending(2);
      await provider.cancel?.("scope");
      expect(cancelled).toEqual([requests[0]]);
      queue.releaseNext();
      queue.releaseNext();
      expect(await old).toMatchObject({ category: "cancelled" });
      if (kind === "ollama") {
        await queue.waitForPending();
        queue.releaseNext();
        await queue.waitForPending();
        queue.releaseNext();
      }
      await next;
      await provider.cancel?.("scope");
      await provider.cancel?.("scope-next");
      expect(cancelled).toEqual([requests[0]]);
    });
    it("deduplicates completed work and rejects cancel-before-start", async () => {
      const calls: any[] = [];
      const provider = create(failureTransport(kind, "missing", true, calls));
      await provider.testConnection("completed");
      const count = calls.length;
      await expect(provider.testConnection("completed")).rejects.toMatchObject({
        category: "cancelled",
      });
      await provider.cancel?.("early");
      await expect(provider.testConnection("early")).rejects.toMatchObject({
        category: "cancelled",
      });
      expect(calls).toHaveLength(count);
    });
    it("checks authority between segments and before accepting a response", async () => {
      let allowed = true;
      const calls: any[] = [];
      const valid = failureTransport(kind, "missing", true, calls);
      const provider = create({
        request: async (request) => {
          const response = await valid.request(request);
          allowed = false;
          return response;
        },
      });
      const request = makeProviderRequest();
      request.items = Array.from({ length: 7 }, (_, index) => ({
        id: `c${index}`,
        text: "sample",
      }));
      const progress: unknown[] = [];
      await expect(
        provider.attempt(
          request,
          (result) => progress.push(result),
          () => {
            if (!allowed) throw { category: "cancelled", retryable: false };
          },
        ),
      ).rejects.toMatchObject({ category: "cancelled" });
      expect(progress).toEqual([]);
      expect(calls.length).toBeLessThanOrEqual(kind === "openai" ? 2 : 1);
    });
  });
}
