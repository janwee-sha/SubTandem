import { describe, expect, it } from "vitest";
import { GlobalProviderClient } from "../../src/adapters/iina/global-provider-client.js";
import { makeProviderRequest } from "./provider-test-helpers.js";

class FakeGlobalPort {
  readonly posted: Array<{ name: string; data: unknown }> = [];
  private readonly handlers = new Map<string, (data: unknown) => void>();

  onMessage(name: string, handler: (data: unknown) => void): void {
    this.handlers.set(name, handler);
  }

  postMessage(name: string, data: unknown): void {
    this.posted.push({ name, data });
  }

  emit(name: string, data: unknown): void {
    this.handlers.get(name)?.(data);
  }
}

describe("Global provider client progress routing", () => {
  it("routes progress by request and removes the handler before terminal resolution", async () => {
    const port = new FakeGlobalPort();
    const client = new GlobalProviderClient(port);
    const request = makeProviderRequest();
    const progress: unknown[] = [];
    const pending = client.attempt(request, (value) => progress.push(value));

    port.emit("provider:attempt-progress", {
      requestId: request.requestId,
      progress: { translations: [{ id: "c1", text: "first" }] },
    });
    port.emit("provider:attempt-result", {
      requestId: request.requestId,
      result: { translations: [{ id: "c1", text: "first" }] },
    });
    port.emit("provider:attempt-progress", {
      requestId: request.requestId,
      progress: { translations: [{ id: "c2", text: "late" }] },
    });

    await expect(pending).resolves.toMatchObject({ translations: [{ id: "c1" }] });
    expect(progress).toEqual([{ translations: [{ id: "c1", text: "first" }] }]);
  });

  it("isolates colliding request IDs across ports and drops cancelled progress", async () => {
    const aPort = new FakeGlobalPort();
    const bPort = new FakeGlobalPort();
    const aClient = new GlobalProviderClient(aPort);
    const bClient = new GlobalProviderClient(bPort);
    const request = makeProviderRequest();
    const aProgress: unknown[] = [];
    const bProgress: unknown[] = [];
    const aPending = aClient.attempt(request, (value) => aProgress.push(value));
    const bPending = bClient.attempt(request, (value) => bProgress.push(value));
    aPending.catch(() => undefined);

    aPort.emit("provider:attempt-progress", {
      requestId: request.requestId,
      progress: { translations: [{ id: "c1", text: "A" }] },
    });
    bPort.emit("provider:attempt-progress", {
      requestId: request.requestId,
      progress: { translations: [{ id: "c1", text: "B" }] },
    });
    aClient.cancel(request.requestId);
    aPort.emit("provider:attempt-progress", {
      requestId: request.requestId,
      progress: { translations: [{ id: "c2", text: "late-A" }] },
    });
    bPort.emit("provider:attempt-result", {
      requestId: request.requestId,
      result: { translations: [{ id: "c1", text: "B" }] },
    });

    await expect(aPending).rejects.toMatchObject({ category: "cancelled" });
    await expect(bPending).resolves.toMatchObject({ translations: [{ text: "B" }] });
    expect(aProgress).toEqual([{ translations: [{ id: "c1", text: "A" }] }]);
    expect(bProgress).toEqual([{ translations: [{ id: "c1", text: "B" }] }]);
  });

  it("rejects progress payloads with fields outside the safe contract", async () => {
    const port = new FakeGlobalPort();
    const client = new GlobalProviderClient(port);
    const request = makeProviderRequest();
    const progress: unknown[] = [];
    const pending = client.attempt(request, (value) => progress.push(value));

    port.emit("provider:attempt-progress", {
      requestId: request.requestId,
      progress: {
        translations: [{ id: "c1", text: "safe" }],
        authorization: "Bearer secret",
        rawBody: "private",
      },
    });
    port.emit("provider:attempt-error", {
      requestId: request.requestId,
      error: { category: "protocol", retryable: false },
    });

    await expect(pending).rejects.toMatchObject({ category: "protocol" });
    expect(progress).toEqual([]);
    expect(JSON.stringify(port.posted)).not.toContain("Bearer secret");
  });
});
