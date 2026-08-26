import { DEFAULT_OVERLAY_POSITION, isOverlayPosition } from "../../domain/overlay-position.js";

export type OverlayPositionPhase = "snapshot" | "preview" | "committed" | "reverted";

export interface OverlayPositionState {
  phase: OverlayPositionPhase;
  position: number;
  committedPosition: number;
  intentSequence: number;
  committedRevision: number;
}

export interface OverlayPositionSaveIntent {
  position: number;
  intentSequence: number;
}

export class OverlayPositionAuthority {
  private livePosition: number;
  private committedPosition: number;
  private intentSequence = 0;
  private committedRevision = 0;
  private committedIntentSequence = 0;

  constructor(initialPosition: number) {
    const position = isOverlayPosition(initialPosition)
      ? initialPosition
      : DEFAULT_OVERLAY_POSITION;
    this.livePosition = position;
    this.committedPosition = position;
  }

  snapshot(): OverlayPositionState {
    return this.state("snapshot");
  }

  preview(position: number): OverlayPositionState {
    this.requirePosition(position);
    this.intentSequence += 1;
    this.livePosition = position;
    return this.state("preview");
  }

  beginSave(position: number): OverlayPositionSaveIntent {
    this.requirePosition(position);
    this.intentSequence += 1;
    this.livePosition = position;
    return { position, intentSequence: this.intentSequence };
  }

  commit(intent: OverlayPositionSaveIntent): OverlayPositionState {
    this.requireIntent(intent);
    if (intent.intentSequence > this.committedIntentSequence) {
      this.committedPosition = intent.position;
      this.committedIntentSequence = intent.intentSequence;
      this.committedRevision += 1;
    }
    if (intent.intentSequence >= this.intentSequence) this.livePosition = intent.position;
    return this.state("committed", intent.intentSequence, this.committedPosition);
  }

  fail(intent: OverlayPositionSaveIntent): OverlayPositionState {
    this.requireIntent(intent);
    if (intent.intentSequence >= this.intentSequence) this.livePosition = this.committedPosition;
    return this.state("reverted", intent.intentSequence, this.committedPosition);
  }

  private state(
    phase: OverlayPositionPhase,
    intentSequence = this.intentSequence,
    position = this.livePosition,
  ): OverlayPositionState {
    return {
      phase,
      position,
      committedPosition: this.committedPosition,
      intentSequence,
      committedRevision: this.committedRevision,
    };
  }

  private requirePosition(position: number): void {
    if (!isOverlayPosition(position)) throw new Error("INVALID_OVERLAY_POSITION");
  }

  private requireIntent(intent: OverlayPositionSaveIntent): void {
    this.requirePosition(intent.position);
    if (!Number.isInteger(intent.intentSequence) || intent.intentSequence < 1)
      throw new Error("INVALID_OVERLAY_POSITION_INTENT");
  }
}

export class OverlayPositionFollower {
  private state: OverlayPositionState = {
    phase: "snapshot",
    position: DEFAULT_OVERLAY_POSITION,
    committedPosition: DEFAULT_OVERLAY_POSITION,
    intentSequence: 0,
    committedRevision: 0,
  };

  get snapshot(): OverlayPositionState {
    return { ...this.state };
  }

  apply(next: OverlayPositionState): boolean {
    if (next.intentSequence < this.state.intentSequence) return false;
    if (
      next.intentSequence === this.state.intentSequence &&
      next.committedRevision < this.state.committedRevision
    )
      return false;
    this.state = { ...next };
    return true;
  }
}
