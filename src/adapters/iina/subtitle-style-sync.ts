import {
  cloneSubtitleTextStyle,
  createFontResolution,
  isSubtitleStyleField,
  isSubtitleStyleValue,
  isSubtitleTextStyle,
  withSubtitleStyleField,
  type FontResolution,
  type SubtitleStyleField,
  type SubtitleTextStyle,
} from "../../domain/subtitle-style.js";

export type SubtitleStyleStatePhase =
  "snapshot" | "preview" | "committed" | "reverted" | "availability";

export interface SubtitleStyleAuthorityState {
  phase: SubtitleStyleStatePhase;
  liveStyle: SubtitleTextStyle;
  committedStyle: SubtitleTextStyle;
  changedField: SubtitleStyleField | null;
  stateRevision: number;
  latestIntentSequence: number;
  committedRevision: number;
  fontResolution: FontResolution;
}

export interface SubtitleStyleIntent<F extends SubtitleStyleField = SubtitleStyleField> {
  interactionId: string;
  field: F;
  value: SubtitleTextStyle[F];
  intentSequence: number;
}

export interface SubtitleStylePreviewResult {
  intent: SubtitleStyleIntent;
  state: SubtitleStyleAuthorityState;
}

export type SubtitleStylePendingResult =
  | {
      outcome: "pending";
      intent: SubtitleStyleIntent;
      candidateStyle: SubtitleTextStyle;
      state: SubtitleStyleAuthorityState;
    }
  | {
      outcome: "superseded";
      intent: SubtitleStyleIntent;
      candidateStyle: null;
      state: SubtitleStyleAuthorityState;
    };

export type SubtitleStyleCompletionResult = {
  outcome: "committed" | "superseded" | "reverted";
  state: SubtitleStyleAuthorityState;
};

const validInteractionId = (value: string): boolean => /^[A-Za-z0-9_.:-]{1,128}$/.test(value);

const cloneIntent = (intent: SubtitleStyleIntent): SubtitleStyleIntent => ({
  ...intent,
  value:
    intent.field === "fontColor" ||
    intent.field === "borderColor" ||
    intent.field === "backgroundColor"
      ? { ...(intent.value as SubtitleTextStyle["fontColor"]) }
      : intent.value,
});

export class SubtitleStyleAuthority {
  private liveStyle: SubtitleTextStyle;
  private committedStyle: SubtitleTextStyle;
  private fontResolution: FontResolution;
  private stateRevision = 0;
  private latestIntentSequence = 0;
  private committedRevision = 0;
  private readonly interactions = new Map<string, SubtitleStyleIntent>();
  private readonly invalidatedInteractions = new Map<string, SubtitleStyleIntent>();
  private readonly latestByField = new Map<SubtitleStyleField, SubtitleStyleIntent>();

  constructor(initialStyle: SubtitleTextStyle, fontResolution?: FontResolution) {
    if (!isSubtitleTextStyle(initialStyle)) throw new Error("INVALID_SUBTITLE_STYLE");
    this.liveStyle = cloneSubtitleTextStyle(initialStyle);
    this.committedStyle = cloneSubtitleTextStyle(initialStyle);
    this.fontResolution = fontResolution
      ? cloneFontResolution(fontResolution)
      : createFontResolution(initialStyle.fontFamily);
  }

  snapshot(): SubtitleStyleAuthorityState {
    return this.state("snapshot", null);
  }

  preview<F extends SubtitleStyleField>(
    interactionId: string,
    field: F,
    value: SubtitleTextStyle[F],
  ): SubtitleStylePreviewResult {
    this.requireEdit(interactionId, field, value);
    this.invalidatedInteractions.delete(interactionId);
    const existing = this.interactions.get(interactionId);
    if (existing && existing.field === field && equalValue(existing.value, value)) {
      return { intent: cloneIntent(existing), state: this.state("preview", field) };
    }
    this.latestIntentSequence += 1;
    const intent = cloneIntent({
      interactionId,
      field,
      value,
      intentSequence: this.latestIntentSequence,
    });
    this.interactions.set(interactionId, intent);
    this.latestByField.set(field, intent);
    this.liveStyle = withSubtitleStyleField(this.liveStyle, field, value);
    this.stateRevision += 1;
    return { intent: cloneIntent(intent), state: this.state("preview", field) };
  }

  beginCommit<F extends SubtitleStyleField>(
    interactionId: string,
    field: F,
    value: SubtitleTextStyle[F],
  ): SubtitleStylePendingResult {
    this.requireEdit(interactionId, field, value);
    const invalidated = this.invalidatedInteractions.get(interactionId);
    if (invalidated) {
      return {
        outcome: "superseded",
        intent: cloneIntent(invalidated),
        candidateStyle: null,
        state: this.state("reverted", null),
      };
    }
    let intent = this.interactions.get(interactionId);
    if (!intent || intent.field !== field || !equalValue(intent.value, value)) {
      intent = this.preview(interactionId, field, value).intent;
    }
    const latest = this.latestByField.get(field);
    if (!latest || latest.intentSequence !== intent.intentSequence) {
      return {
        outcome: "superseded",
        intent: cloneIntent(intent),
        candidateStyle: null,
        state: this.state("preview", field),
      };
    }
    return {
      outcome: "pending",
      intent: cloneIntent(intent),
      candidateStyle: withSubtitleStyleField(this.committedStyle, field, value),
      state: this.state("preview", field),
    };
  }

  commit(intent: SubtitleStyleIntent): SubtitleStyleCompletionResult {
    this.requireIntent(intent);
    const latest = this.latestByField.get(intent.field);
    if (!latest || latest.intentSequence !== intent.intentSequence) {
      return { outcome: "superseded", state: this.state("preview", intent.field) };
    }
    this.committedStyle = withSubtitleStyleField(this.committedStyle, intent.field, intent.value);
    this.liveStyle = withSubtitleStyleField(this.liveStyle, intent.field, intent.value);
    this.committedRevision += 1;
    this.stateRevision += 1;
    if (this.interactions.get(intent.interactionId)?.intentSequence === intent.intentSequence)
      this.interactions.delete(intent.interactionId);
    return { outcome: "committed", state: this.state("committed", intent.field) };
  }

  fail(intent: SubtitleStyleIntent): SubtitleStyleCompletionResult {
    this.requireIntent(intent);
    const latest = this.latestByField.get(intent.field);
    if (!latest || latest.intentSequence !== intent.intentSequence) {
      return { outcome: "superseded", state: this.state("preview", intent.field) };
    }
    for (const [interactionId, active] of this.interactions)
      this.invalidatedInteractions.set(interactionId, active);
    this.interactions.clear();
    this.latestByField.clear();
    this.liveStyle = cloneSubtitleTextStyle(this.committedStyle);
    this.fontResolution = createFontResolution(
      this.committedStyle.fontFamily,
      this.fontResolution.availability,
      this.fontResolution.catalogRevision,
    );
    this.stateRevision += 1;
    return { outcome: "reverted", state: this.state("reverted", null) };
  }

  updateFontResolution(resolution: FontResolution): SubtitleStyleAuthorityState {
    this.fontResolution = cloneFontResolution(resolution);
    this.stateRevision += 1;
    return this.state("availability", null);
  }

  private state(
    phase: SubtitleStyleStatePhase,
    changedField: SubtitleStyleField | null,
  ): SubtitleStyleAuthorityState {
    return {
      phase,
      liveStyle: cloneSubtitleTextStyle(this.liveStyle),
      committedStyle: cloneSubtitleTextStyle(this.committedStyle),
      changedField,
      stateRevision: this.stateRevision,
      latestIntentSequence: this.latestIntentSequence,
      committedRevision: this.committedRevision,
      fontResolution: cloneFontResolution(this.fontResolution),
    };
  }

  private requireEdit<F extends SubtitleStyleField>(
    interactionId: string,
    field: F,
    value: SubtitleTextStyle[F],
  ): void {
    if (
      !validInteractionId(interactionId) ||
      !isSubtitleStyleField(field) ||
      !isSubtitleStyleValue(field, value)
    )
      throw new Error("INVALID_SUBTITLE_STYLE_INTENT");
  }

  private requireIntent(intent: SubtitleStyleIntent): void {
    if (
      !intent ||
      !validInteractionId(intent.interactionId) ||
      !isSubtitleStyleField(intent.field) ||
      !isSubtitleStyleValue(intent.field, intent.value) ||
      !Number.isInteger(intent.intentSequence) ||
      intent.intentSequence < 1 ||
      intent.intentSequence > this.latestIntentSequence
    )
      throw new Error("INVALID_SUBTITLE_STYLE_INTENT");
  }
}

export class SubtitleStyleFollower {
  private current: SubtitleStyleAuthorityState | null = null;

  get snapshot(): SubtitleStyleAuthorityState | null {
    return this.current ? cloneState(this.current) : null;
  }

  apply(next: SubtitleStyleAuthorityState): boolean {
    requireState(next);
    if (!this.current) {
      this.current = cloneState(next);
      return true;
    }
    if (next.stateRevision < this.current.stateRevision) return false;
    if (next.stateRevision === this.current.stateRevision) {
      if (JSON.stringify(next) !== JSON.stringify(this.current))
        throw new Error("CONFLICTING_SUBTITLE_STYLE_STATE");
      return true;
    }
    this.current = cloneState(next);
    return true;
  }
}

function cloneFontResolution(resolution: FontResolution): FontResolution {
  const expected = createFontResolution(
    resolution.preferredFamily,
    resolution.availability,
    resolution.catalogRevision,
  );
  if (
    resolution.effectiveFamily !== expected.effectiveFamily ||
    resolution.fallbackActive !== expected.fallbackActive
  )
    throw new Error("INVALID_FONT_RESOLUTION");
  return { ...resolution };
}

function cloneState(state: SubtitleStyleAuthorityState): SubtitleStyleAuthorityState {
  return {
    ...state,
    liveStyle: cloneSubtitleTextStyle(state.liveStyle),
    committedStyle: cloneSubtitleTextStyle(state.committedStyle),
    fontResolution: cloneFontResolution(state.fontResolution),
  };
}

function requireState(state: SubtitleStyleAuthorityState): void {
  if (
    !state ||
    !["snapshot", "preview", "committed", "reverted", "availability"].includes(state.phase) ||
    !isSubtitleTextStyle(state.liveStyle) ||
    !isSubtitleTextStyle(state.committedStyle) ||
    (state.changedField !== null && !isSubtitleStyleField(state.changedField)) ||
    !Number.isInteger(state.stateRevision) ||
    state.stateRevision < 0 ||
    !Number.isInteger(state.latestIntentSequence) ||
    state.latestIntentSequence < 0 ||
    !Number.isInteger(state.committedRevision) ||
    state.committedRevision < 0
  )
    throw new Error("INVALID_SUBTITLE_STYLE_STATE");
  cloneFontResolution(state.fontResolution);
}

function equalValue(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}
