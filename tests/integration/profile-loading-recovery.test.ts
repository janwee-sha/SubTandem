import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { nativeGlobalLifecycle } from "../helpers/native-global-lifecycle.js";

afterEach(() => vi.unstubAllGlobals());
describe("production startup recovery", () => {
  it.each([
    "",
    "{",
    '{"formatVersion":99}',
    '{"formatVersion":2,"profileState":{"profiles":"bad"}}',
  ])(
    "recovers safe damaged input %s, saves a new profile and retains it on restart",
    async (input) => {
      let prepared = false;
      const h = await nativeGlobalLifecycle({
        beforeStart(directory) {
          if (prepared) return;
          prepared = true;
          writeFileSync(join(directory, "credentials.json"), input, { mode: 0o600 });
        },
      });
      try {
        expect((await h.global.authority()).ready).toBe(true);
        expect(await h.global.profiles()).toEqual([]);
        expect(h.snapshot().lastCommit.operation).toBe("recover");
        await h.global.save(
          {
            displayName: "Recovered",
            kind: "openai",
            endpoint: "https://example.test/v1",
            proxyMode: "direct",
            model: "model",
          },
          "",
        );
        const saved = await h.global.profiles();
        expect(saved).toHaveLength(1);
        expect((await h.global.authority()).activation).toBeNull();
        await h.restart();
        expect(await h.global.profiles()).toEqual(saved);
        expect((await h.global.authority()).activation).toBeNull();
      } finally {
        await h.close();
      }
    },
    20_000,
  );
});

it("preserves healthy persistent bytes during a temporary transport outage and merges a retried new profile", async () => {
  let blocked = false;
  const h = await nativeGlobalLifecycle({
    async beforeRPC(path) {
      if (blocked && path === "/v2/profile-state")
        throw new Error("synthetic temporary transport failure");
    },
  });
  try {
    await h.global.save(
      {
        displayName: "Existing",
        kind: "openai",
        endpoint: "https://existing.test/v1",
        proxyMode: "direct",
        model: "model",
      },
      "",
    );
    const original = (await h.global.profiles())[0];
    await h.global.send("profile-activation:set", {
      authorityId: (await h.global.authority()).authorityId,
      profileId: original.profileId,
      profileRevision: original.revision,
      endpointFingerprint: original.endpointFingerprint,
      enabled: true,
    });
    const bytes = h.bytes();
    blocked = true;
    await h.restart();
    expect((await h.global.authority()).ready).toBe(false);
    expect(await h.global.profiles()).toEqual([]);
    expect(h.bytes()).toEqual(bytes);
    const draft = {
      displayName: "Unsaved retry",
      kind: "openai" as const,
      endpoint: "https://new.test/v1",
      proxyMode: "direct" as const,
      model: "model",
    };
    await expect(h.global.save(draft, "")).rejects.toThrow();
    expect(h.bytes()).toEqual(bytes);
    blocked = false;
    await h.global.save(draft, "");
    const recovered = await h.global.authority();
    expect(recovered.profiles.map((p: any) => p.displayName)).toEqual([
      "Unsaved retry",
      "Existing",
    ]);
    expect(recovered.activation).toBeNull();
    expect(recovered.activationGeneration).toBe(0);
    expect(h.snapshot().profileState.activation.profileId).toBe(original.profileId);
    await h.restart();
    expect(await h.global.profiles()).toHaveLength(2);
  } finally {
    await h.close();
  }
}, 20_000);
