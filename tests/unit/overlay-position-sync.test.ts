import { describe, expect, it } from "vitest";
import {
  OverlayPositionAuthority,
  OverlayPositionFollower,
} from "../../src/adapters/iina/overlay-position-sync.js";

describe("overlay position synchronization", () => {
  it("assigns monotonic intent sequences and committed revisions", () => {
    const authority = new OverlayPositionAuthority(0);
    const preview = authority.preview(25);
    const save = authority.beginSave(50);
    expect(preview).toMatchObject({ phase: "preview", intentSequence: 1, position: 25 });
    expect(save.intentSequence).toBe(2);
    expect(authority.commit(save)).toMatchObject({
      phase: "committed",
      position: 50,
      committedPosition: 50,
      committedRevision: 1,
    });
  });

  it("reverts a newer failed save to the last successful value", () => {
    const authority = new OverlayPositionAuthority(10);
    authority.commit(authority.beginSave(25));
    const failed = authority.fail(authority.beginSave(80));
    expect(failed).toMatchObject({
      phase: "reverted",
      position: 25,
      committedPosition: 25,
      intentSequence: 2,
      committedRevision: 1,
    });
  });

  it("ignores old states while accepting equal-sequence commit and revert", () => {
    const follower = new OverlayPositionFollower();
    expect(
      follower.apply({
        phase: "preview",
        position: 80,
        committedPosition: 0,
        intentSequence: 3,
        committedRevision: 0,
      }),
    ).toBe(true);
    expect(
      follower.apply({
        phase: "committed",
        position: 50,
        committedPosition: 50,
        intentSequence: 2,
        committedRevision: 1,
      }),
    ).toBe(false);
    expect(follower.snapshot.position).toBe(80);
    expect(
      follower.apply({
        phase: "reverted",
        position: 25,
        committedPosition: 25,
        intentSequence: 3,
        committedRevision: 1,
      }),
    ).toBe(true);
    expect(follower.snapshot.position).toBe(25);
  });
});
