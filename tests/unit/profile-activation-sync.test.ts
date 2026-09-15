import { describe, expect, it } from "vitest";
import type { AuthoritySnapshot } from "../../src/domain/types.js";
import { ProfileActivationSync } from "../../src/adapters/iina/profile-activation-sync.js";

function snapshot(stateVersion: number, authorityId = "authority-1"): AuthoritySnapshot {
  return {
    authorityId,
    stateVersion,
    ready: true,
    activationGeneration: stateVersion,
    activation: null,
    profiles: [],
  };
}

describe("Main Profile activation synchronization", () => {
  it("establishes only from the correlated get response", () => {
    const sync = new ProfileActivationSync("activation.get.1");
    expect(sync.accept(snapshot(1), "wrong-request")).toBe(false);
    expect(sync.accept(snapshot(1), "activation.get.1")).toBe(true);
    expect(sync.snapshot).toEqual(snapshot(1));
  });

  it("rejects foreign, lower and conflicting same-version snapshots", () => {
    const sync = new ProfileActivationSync("activation.get.1");
    sync.accept(snapshot(2), "activation.get.1");

    expect(sync.accept(snapshot(3, "authority-2"))).toBe(false);
    expect(sync.accept(snapshot(1))).toBe(false);
    expect(sync.accept(snapshot(2))).toBe(true);
    expect(sync.accept({ ...snapshot(2), ready: false })).toBe(false);
    expect(sync.accept(snapshot(3))).toBe(true);
    expect(sync.snapshot?.stateVersion).toBe(3);
  });
});
