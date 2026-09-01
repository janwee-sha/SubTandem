import { describe, expect, it } from "vitest";
import {
  SubtitleStyleAuthority,
  SubtitleStyleFollower,
} from "../../src/adapters/iina/subtitle-style-sync.js";
import { DEFAULT_SUBTITLE_TEXT_STYLE } from "../../src/domain/subtitle-style.js";

describe("subtitle style authority", () => {
  it("merges different-field previews and persists only the committing field", () => {
    const authority = new SubtitleStyleAuthority(DEFAULT_SUBTITLE_TEXT_STYLE);
    const bold = authority.preview("bold-1", "bold", true);
    const italic = authority.preview("italic-1", "italic", true);
    expect(italic.state.liveStyle).toMatchObject({ bold: true, italic: true });
    const pending = authority.beginCommit("bold-1", "bold", true);
    expect(pending.outcome).toBe("pending");
    expect(pending.candidateStyle).toMatchObject({ bold: true, italic: false });
    const committed = authority.commit(pending.intent);
    expect(committed.outcome).toBe("committed");
    expect(committed.state.committedStyle).toMatchObject({ bold: true, italic: false });
    expect(committed.state.liveStyle).toMatchObject({ bold: true, italic: true });
    expect(bold.intent.intentSequence).toBe(1);
  });

  it("uses the last actual intent for the same field and supersedes the older one", () => {
    const authority = new SubtitleStyleAuthority(DEFAULT_SUBTITLE_TEXT_STYLE);
    const first = authority.preview("size-1", "fontSize", 45);
    const second = authority.preview("size-2", "fontSize", 50);
    expect(second.intent.intentSequence).toBeGreaterThan(first.intent.intentSequence);
    const oldCommit = authority.beginCommit("size-1", "fontSize", 45);
    expect(oldCommit.outcome).toBe("superseded");
    expect(oldCommit.candidateStyle).toBeNull();
    const latest = authority.beginCommit("size-2", "fontSize", 50);
    expect(authority.commit(latest.intent).state.liveStyle.fontSize).toBe(50);
  });

  it("reuses the last preview intent when an interaction commits", () => {
    const authority = new SubtitleStyleAuthority(DEFAULT_SUBTITLE_TEXT_STYLE);
    const preview = authority.preview("color-1", "fontColor", { r: 1, g: 2, b: 3, a: 4 });
    const pending = authority.beginCommit("color-1", "fontColor", {
      r: 1,
      g: 2,
      b: 3,
      a: 4,
    });
    expect(pending.intent.intentSequence).toBe(preview.intent.intentSequence);
    expect(pending.state.latestIntentSequence).toBe(preview.intent.intentSequence);
  });

  it("reverts all live fields and invalidates previews after a real save failure", () => {
    const authority = new SubtitleStyleAuthority(DEFAULT_SUBTITLE_TEXT_STYLE);
    authority.commit(authority.beginCommit("bold-1", "bold", true).intent);
    const size = authority.beginCommit("size-1", "fontSize", 55);
    authority.preview("italic-1", "italic", true);
    const failed = authority.fail(size.intent);
    expect(failed.outcome).toBe("reverted");
    expect(failed.state.liveStyle).toEqual(failed.state.committedStyle);
    expect(failed.state.liveStyle).toMatchObject({ bold: true, fontSize: 40, italic: false });
    expect(authority.beginCommit("italic-1", "italic", true).outcome).toBe("superseded");
  });

  it("keeps state, intent and committed revisions independent and monotonic", () => {
    const authority = new SubtitleStyleAuthority(DEFAULT_SUBTITLE_TEXT_STYLE);
    const initial = authority.snapshot();
    const preview = authority.preview("bold-1", "bold", true);
    const committed = authority.commit(authority.beginCommit("bold-1", "bold", true).intent);
    expect(preview.state.stateRevision).toBeGreaterThan(initial.stateRevision);
    expect(preview.state.latestIntentSequence).toBe(1);
    expect(preview.state.committedRevision).toBe(0);
    expect(committed.state.stateRevision).toBeGreaterThan(preview.state.stateRevision);
    expect(committed.state.latestIntentSequence).toBe(1);
    expect(committed.state.committedRevision).toBe(1);
  });

  it("rejects stale follower state while accepting an idempotent duplicate", () => {
    const authority = new SubtitleStyleAuthority(DEFAULT_SUBTITLE_TEXT_STYLE);
    const follower = new SubtitleStyleFollower();
    const snapshot = authority.snapshot();
    const preview = authority.preview("bold-1", "bold", true).state;
    expect(follower.apply(snapshot)).toBe(true);
    expect(follower.apply(preview)).toBe(true);
    expect(follower.apply(snapshot)).toBe(false);
    expect(follower.apply(preview)).toBe(true);
    expect(() => follower.apply({ ...preview, committedRevision: 99 })).toThrow(
      "CONFLICTING_SUBTITLE_STYLE_STATE",
    );
  });
});
