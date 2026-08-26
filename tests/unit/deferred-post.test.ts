import { describe, expect, it, vi } from "vitest";

import { createDeferredPlayerPost } from "../../src/adapters/iina/deferred-post.js";

describe("deferred IINA global replies", () => {
  it("crosses a timer boundary before posting back to a player", () => {
    const queued: Array<() => void> = [];
    const post = vi.fn();
    const reply = createDeferredPlayerPost(post, (callback, delayMs) => {
      expect(delayMs).toBe(0);
      queued.push(callback);
    });

    reply("player-A", "main:registered", { playerId: "player-A" });
    expect(post).not.toHaveBeenCalled();

    queued.shift()?.();
    expect(post).toHaveBeenCalledWith("player-A", "main:registered", {
      playerId: "player-A",
    });
  });
});
