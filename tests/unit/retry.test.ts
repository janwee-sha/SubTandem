import { describe, expect, it, vi } from "vitest";
import {
  classifyAttemptFailure,
  parseRetryAfter,
  retryDelayMs,
  RetryTimerSet,
} from "../../src/app/retry-policy.js";
import { FakeClock } from "../helpers/fake-clock.js";

describe("retry policy", () => {
  it("classifies temporary versus permanent failures", () => {
    expect(classifyAttemptFailure({ statusCode: 503 })).toMatchObject({
      retryable: true,
      category: "http",
    });
    expect(classifyAttemptFailure({ statusCode: 401 })).toMatchObject({
      retryable: false,
      category: "authentication",
    });
    expect(
      classifyAttemptFailure({ statusCode: 429, providerCode: "insufficient_quota" }),
    ).toMatchObject({ retryable: false, category: "quota" });
    expect(classifyAttemptFailure({ category: "timeout" })).toMatchObject({ retryable: true });
  });

  it("parses delta/date Retry-After and ignores invalid or negative values", () => {
    const now = Date.UTC(2026, 7, 10, 0, 0, 0);
    expect(parseRetryAfter("3", now)).toBe(3_000);
    expect(parseRetryAfter("Mon, 10 Aug 2026 00:00:04 GMT", now)).toBe(4_000);
    expect(parseRetryAfter("-1", now)).toBeUndefined();
    expect(parseRetryAfter("soon", now)).toBeUndefined();
  });

  it("caps at three retries and uses 1s/2s/4s jitter with Retry-After as a floor", () => {
    expect(retryDelayMs(1, () => 0.5)).toBe(1_125);
    expect(retryDelayMs(2, () => 0.5)).toBe(2_250);
    expect(retryDelayMs(3, () => 0.5, 5_000)).toBe(5_000);
    expect(() => retryDelayMs(4, () => 0)).toThrow();
  });

  it("cancels stale timers and never fires them into another session/window", () => {
    const clock = new FakeClock();
    const fired = vi.fn();
    const timers = new RetryTimerSet(clock);
    timers.schedule(1_000, fired);
    timers.cancelAll();
    clock.advanceBy(2_000);
    expect(fired).not.toHaveBeenCalled();
    expect(timers.size).toBe(0);
  });
});
