import { describe, expect, it, vi } from "vitest";
import { HostClock, HostTimers, hostClock } from "../../src/adapters/iina/host-timers.js";
describe("host callback clock", () => {
  it("runs callbacks only from an active host pulse and never catches up old polling", () => {
    let now = 0,
      count = 0;
    const c = new HostClock(() => now);
    c.setInterval(() => count++, 20);
    now = 20;
    expect(count).toBe(0);
    c.pulse();
    expect(count).toBe(1);
    now = 1000;
    c.pulse();
    expect(count).toBe(2);
  });
  it("cancels pending timeout and interval callbacks before a queued pulse", () => {
    let now = 0,
      count = 0;
    const c = new HostClock(() => now);
    const t = c.setTimeout(() => count++, 5),
      i = c.setInterval(() => count++, 5);
    c.clearTimeout(t);
    c.clearInterval(i);
    now = 10;
    c.pulse();
    expect(count).toBe(0);
  });
  it("respects registration during callbacks and leaves destroyed contexts dormant", () => {
    let now = 0,
      count = 0;
    const c = new HostClock(() => now);
    c.setTimeout(() => {
      count++;
      c.setTimeout(() => count++, 0);
    }, 0);
    c.pulse();
    expect(count).toBe(1);
    now = 100;
    c.pulse();
    expect(count).toBe(2);
    c.setInterval(() => count++, 1);
    now = 10000;
    expect(count).toBe(2);
  });
  it("selects the live WebView clock when IINA appears after module import", () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    vi.stubGlobal("iina", {});
    try {
      let count = 0;
      const interval = new HostTimers().setInterval(() => count++, 20);
      vi.advanceTimersByTime(1000);
      expect(count).toBe(0);
      hostClock.pulse();
      expect(count).toBe(1);
      interval.cancel();
      vi.advanceTimersByTime(1000);
      hostClock.pulse();
      expect(count).toBe(1);
    } finally {
      vi.unstubAllGlobals();
      vi.useRealTimers();
    }
  });
});
