import { describe, expect, it, vi } from "vitest";
import { PlaybackSession } from "../../src/app/playback-session.js";

describe("player-local PlaybackSession", () => {
  it("handles nullable position and pause/resume without invalidating the file", () => {
    const session = new PlaybackSession("player-A", "session-1");
    session.updatePosition(null);
    session.setPaused(true);
    session.setPaused(false);
    expect(session.positionMs).toBeNull();
    expect(session.sessionEpoch).toBe(0);
  });

  it("increments file/track epochs and seek window epochs, rejecting delayed results", () => {
    const session = new PlaybackSession("player-A", "session-1");
    const initial = session.fingerprint();
    session.onSeek(10_000);
    expect(session.accepts(initial)).toBe(false);
    const afterSeek = session.fingerprint();
    session.onTrackChanged();
    expect(session.accepts(afterSeek)).toBe(false);
    expect(session.sessionEpoch).toBe(1);
    expect(session.windowEpoch).toBe(0);
  });

  it("cancels player-local timers and jobs on close", () => {
    const cancel = vi.fn();
    const a = new PlaybackSession("player-A", "same-session");
    const b = new PlaybackSession("player-B", "same-session");
    a.registerCancellation(cancel);
    a.close();
    expect(cancel).toHaveBeenCalledOnce();
    expect(a.fingerprint().playerId).not.toBe(b.fingerprint().playerId);
    expect(a.closed).toBe(true);
  });
});
