import { describe, expect, it } from "vitest";
import { OverlayRegionRuntime } from "../../src/adapters/iina/overlay-region-runtime.js";

class RegionMpv {
  readonly reads: string[] = [];
  readonly values = new Map<string, unknown>([
    ["osd-dimensions", { h: 800, mt: 100, mb: 100 }],
    ["sub-margin-x", 24],
    ["sub-margin-y", 32],
    ["sub-margin-y-offset", 4],
    ["sub-use-margins", false],
  ]);
  readonly failures = new Set<string>();

  getNative<T>(name: string): T {
    this.reads.push(name);
    if (this.failures.has(name)) throw new Error("UNAVAILABLE");
    return this.values.get(name) as T;
  }

  getNumber(name: string): number {
    this.reads.push(name);
    if (this.failures.has(name)) throw new Error("UNAVAILABLE");
    return this.values.get(name) as number;
  }

  getFlag(name: string): boolean {
    this.reads.push(name);
    if (this.failures.has(name)) throw new Error("UNAVAILABLE");
    return this.values.get(name) as boolean;
  }
}

describe("Overlay region runtime", () => {
  it("isolates one unavailable property without discarding video geometry or margin mode", () => {
    const mpv = new RegionMpv();
    mpv.failures.add("sub-margin-y-offset");
    const runtime = new OverlayRegionRuntime(mpv, true);
    expect(runtime.snapshot).toEqual({
      top: 0.125,
      bottom: 0.875,
      marginX: 24,
      marginY: 32,
    });
  });

  it("uses cached inputs for fullscreen changes without reading mpv", () => {
    const mpv = new RegionMpv();
    mpv.values.set("sub-use-margins", true);
    const runtime = new OverlayRegionRuntime(mpv, false);
    expect(runtime.snapshot).toMatchObject({ top: 0.125, bottom: 0.875 });
    const reads = [...mpv.reads];
    expect(runtime.setFullscreen(true)).toMatchObject({ top: 0, bottom: 1 });
    expect(mpv.reads).toEqual(reads);
  });

  it("refreshes only the changed property and performs no reads after close", () => {
    const mpv = new RegionMpv();
    const runtime = new OverlayRegionRuntime(mpv, true);
    mpv.reads.splice(0);
    mpv.values.set("sub-use-margins", true);
    expect(runtime.refreshUseMargins()).toMatchObject({ top: 0, bottom: 1 });
    expect(mpv.reads).toEqual(["sub-use-margins"]);
    runtime.close();
    const closed = runtime.snapshot;
    runtime.refreshDimensions();
    runtime.refreshMarginX();
    runtime.refreshMarginY();
    runtime.refreshMarginYOffset();
    runtime.refreshUseMargins();
    runtime.setFullscreen(false);
    expect(runtime.snapshot).toEqual(closed);
    expect(mpv.reads).toEqual(["sub-use-margins"]);
  });

  it("polls host-only dynamic inputs and emits only when the effective region changes", () => {
    const mpv = new RegionMpv();
    const runtime = new OverlayRegionRuntime(mpv, true);
    mpv.reads.splice(0);
    expect(runtime.pollDynamicInputs()).toBeNull();
    expect(mpv.reads).toEqual(["osd-dimensions", "sub-use-margins"]);
    mpv.reads.splice(0);
    mpv.values.set("sub-use-margins", true);
    expect(runtime.pollDynamicInputs()).toMatchObject({ top: 0, bottom: 1 });
    expect(mpv.reads).toEqual(["osd-dimensions", "sub-use-margins"]);
    mpv.reads.splice(0);
    mpv.values.set("osd-dimensions", { h: 800, mt: 160, mb: 80 });
    mpv.values.set("sub-use-margins", false);
    expect(runtime.pollDynamicInputs()).toMatchObject({ top: 0.2, bottom: 0.9 });
    runtime.close();
    mpv.reads.splice(0);
    expect(runtime.pollDynamicInputs()).toBeNull();
    expect(mpv.reads).toEqual([]);
  });
});
