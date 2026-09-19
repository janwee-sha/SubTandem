import { describe, expect, it, vi } from "vitest";
import { EpochBootstrapGate } from "../../src/app/epoch-bootstrap-gate.js";

describe("EpochBootstrapGate", () => {
  it("shares one in-flight bootstrap", async () => {
    let resolve!: (value: string) => void;
    const pending = new Promise<string>((settle) => {
      resolve = settle;
    });
    const start = vi.fn(() => pending);
    const gate = new EpochBootstrapGate<string>();

    const first = gate.run(3, start, () => new Error("FAILED"));
    const second = gate.run(3, start, () => new Error("FAILED"));
    expect(first).toBe(second);
    expect(start).toHaveBeenCalledTimes(1);
    resolve("ready");
    await expect(first).resolves.toBe("ready");
  });

  it("latches a failure for one epoch and permits the next epoch", async () => {
    const start = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(new Error("BOOTSTRAP_FAILED"))
      .mockResolvedValueOnce("ready");
    const gate = new EpochBootstrapGate<string>();

    await expect(gate.run(7, start, () => new Error("LATCHED"))).rejects.toThrow(
      "BOOTSTRAP_FAILED",
    );
    await expect(gate.run(7, start, () => new Error("LATCHED"))).rejects.toThrow("LATCHED");
    expect(start).toHaveBeenCalledTimes(1);
    await expect(gate.run(8, start, () => new Error("LATCHED"))).resolves.toBe("ready");
    expect(start).toHaveBeenCalledTimes(2);
  });
});
