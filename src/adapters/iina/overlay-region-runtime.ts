import {
  normalizeOverlayRegion,
  type OsdDimensions,
  type OverlayRegion,
} from "../../domain/overlay-position.js";

export interface OverlayRegionMpv {
  getNative<T>(name: string): T;
  getNumber(name: string): number;
  getFlag(name: string): boolean;
}

export class OverlayRegionRuntime {
  private active = true;
  private dimensions: OsdDimensions | undefined;
  private fullscreen: boolean;
  private useMargins: boolean | undefined;
  private marginX: number | undefined;
  private marginY: number | undefined;
  private marginYOffset: number | undefined;

  constructor(
    private readonly mpv: OverlayRegionMpv,
    fullscreen: boolean,
  ) {
    this.fullscreen = fullscreen;
    this.refreshDimensions();
    this.refreshMarginX();
    this.refreshMarginY();
    this.refreshMarginYOffset();
    this.refreshUseMargins();
  }

  get snapshot(): OverlayRegion {
    return normalizeOverlayRegion({
      ...(this.dimensions ? { dimensions: this.dimensions } : {}),
      fullscreen: this.fullscreen,
      useMargins: this.useMargins === true,
      ...(this.marginX === undefined ? {} : { marginX: this.marginX }),
      ...(this.marginY === undefined ? {} : { marginY: this.marginY }),
      ...(this.marginYOffset === undefined ? {} : { marginYOffset: this.marginYOffset }),
    });
  }

  refreshDimensions(): OverlayRegion {
    if (this.active)
      this.dimensions = this.read(() => this.mpv.getNative<OsdDimensions>("osd-dimensions"));
    return this.snapshot;
  }

  refreshMarginX(): OverlayRegion {
    if (this.active) this.marginX = this.read(() => this.mpv.getNumber("sub-margin-x"));
    return this.snapshot;
  }

  refreshMarginY(): OverlayRegion {
    if (this.active) this.marginY = this.read(() => this.mpv.getNumber("sub-margin-y"));
    return this.snapshot;
  }

  refreshMarginYOffset(): OverlayRegion {
    if (this.active)
      this.marginYOffset = this.read(() => this.mpv.getNumber("sub-margin-y-offset"));
    return this.snapshot;
  }

  refreshUseMargins(): OverlayRegion {
    if (this.active) this.useMargins = this.read(() => this.mpv.getFlag("sub-use-margins"));
    return this.snapshot;
  }

  pollDynamicInputs(): OverlayRegion | null {
    if (!this.active) return null;
    const previous = this.snapshot;
    const dimensions = this.read(() => this.mpv.getNative<OsdDimensions>("osd-dimensions"));
    const useMargins = this.read(() => this.mpv.getFlag("sub-use-margins"));
    if (dimensions !== undefined) this.dimensions = dimensions;
    if (useMargins !== undefined) this.useMargins = useMargins;
    const current = this.snapshot;
    return this.sameRegion(previous, current) ? null : current;
  }

  setFullscreen(fullscreen: boolean): OverlayRegion {
    if (this.active) this.fullscreen = fullscreen;
    return this.snapshot;
  }

  close(): void {
    this.active = false;
  }

  private read<T>(operation: () => T): T | undefined {
    try {
      return operation();
    } catch {
      return undefined;
    }
  }

  private sameRegion(left: OverlayRegion, right: OverlayRegion): boolean {
    return (
      left.top === right.top &&
      left.bottom === right.bottom &&
      left.marginX === right.marginX &&
      left.marginY === right.marginY
    );
  }
}
