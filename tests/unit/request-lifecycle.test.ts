import { describe, expect, it, vi } from "vitest";
import { RequestLifecycle } from "../../src/providers/request-lifecycle.js";
import { RequestLifecycleHarness } from "../helpers/provider-request-lifecycle.js";

const input = (
  requestId = "r",
  senderId = "window",
  operation: "models" | "test" | "translation" = "models",
) => ({ requestId, senderId, operation, context: { revision: 1 } });
const request = {
  jobId: "job",
  method: "GET" as const,
  url: "http://localhost/models",
  headers: {},
  timeoutMs: 1000,
  maxResponseBytes: 1000,
};

describe("request lifecycle", () => {
  it("records preparation synchronously, rejects duplicate and completed IDs", () => {
    const life = new RequestLifecycle<{ revision: number }>();
    const owner = life.begin(input())!;
    expect(owner.phase).toBe("preparing");
    expect(life.begin(input())).toBeNull();
    life.finish(owner);
    expect(life.begin(input())).toBeNull();
    expect(() => life.assertActive(owner)).toThrow();
    expect(life.activeCount()).toBe(0);
  });
  it("remembers cancellation before begin and closes a window lifecycle", async () => {
    const life = new RequestLifecycle();
    await life.cancel("window", "models", "late");
    expect(life.begin(input("late"))).toBeNull();
    await life.releaseSender("window");
    expect(life.begin(input("new"))).toBeNull();
    expect(life.begin(input("new", "other"))).not.toBeNull();
  });
  it("invalidates before awaiting cancellation and isolates other owners", async () => {
    const life = new RequestLifecycle();
    const transport = new RequestLifecycleHarness();
    transport.holdCancellation = true;
    const old = life.begin(input())!;
    const other = life.begin(input("r", "other"))!;
    const test = life.begin(input("r", "window", "test"))!;
    const pending = life
      .transport(old, transport)
      .request(request)
      .catch((error) => error);
    const cancellation = life.cancel("window", "models", "r");
    expect(life.isActive(old)).toBe(false);
    expect(life.isActive(other)).toBe(true);
    expect(life.isActive(test)).toBe(true);
    const next = life.begin(input("next"))!;
    await life.cancel("window", "models", "r");
    expect(life.isActive(next)).toBe(true);
    transport.responses.releaseNext({ statusCode: 200, headers: {}, bodyText: "{}" });
    expect(await pending).toMatchObject({ category: "cancelled" });
    transport.cancellations.releaseNext();
    await cancellation;
    expect(transport.cancelled).toEqual(["job"]);
    expect(old.jobs.size).toBe(0);
  });
  it("checks authorization before and after every access and clears references", async () => {
    const life = new RequestLifecycle();
    const transport = new RequestLifecycleHarness();
    const owner = life.begin(input())!;
    let authorized = true;
    const wrapped = life.transport(owner, transport, () => authorized);
    const pending = wrapped.request(request).catch((error) => error);
    authorized = false;
    transport.responses.releaseNext({ statusCode: 200, headers: {}, bodyText: "{}" });
    expect(await pending).toMatchObject({ category: "cancelled" });
    await expect(wrapped.request({ ...request, jobId: "second" })).rejects.toMatchObject({
      category: "cancelled",
    });
    expect(transport.calls).toHaveLength(1);
    life.finish(owner);
    expect(owner.jobs.size).toBe(0);
  });
  it("replaces only the same sender and operation and tolerates cancel failure", async () => {
    const life = new RequestLifecycle();
    const old = life.begin(input())!;
    const cancel = vi.fn().mockRejectedValue(new Error("cancel failed"));
    life.track(old, "job", cancel);
    const next = life.begin(input("next"), true)!;
    expect(life.isActive(old)).toBe(false);
    expect(life.isActive(next)).toBe(true);
    await life.cancel("window", "models", "r");
    expect(next.phase).toBe("preparing");
    expect(cancel).toHaveBeenCalledTimes(1);
  });
});
