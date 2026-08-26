import type { PlaybackFingerprint } from "./playback-session.js";
import type { FrozenTranslationTarget, TranslationBatchRequest } from "../providers/types.js";
import type { SubtitleCue } from "../subtitles/types.js";

const CONTEXT_CODE_POINT_LIMIT = 500;

function takeCodePoints(text: string, limit: number): string {
  return [...text].slice(0, limit).join("");
}

export function freezeTranslationTargets(input: {
  windowCues: readonly SubtitleCue[];
  targetCues: readonly SubtitleCue[];
}): FrozenTranslationTarget[] {
  const targetIds = new Set(input.targetCues.map((cue) => cue.id));
  return input.windowCues.flatMap((cue, index) => {
    if (!targetIds.has(cue.id)) return [];
    let remainingContext = CONTEXT_CODE_POINT_LIMIT;
    const previousText = input.windowCues[index - 1]?.normalizedText ?? "";
    const contextPrevious = takeCodePoints(previousText, remainingContext);
    remainingContext -= [...contextPrevious].length;
    const nextText = input.windowCues[index + 1]?.normalizedText ?? "";
    const contextNext = takeCodePoints(nextText, remainingContext);
    return [
      {
        id: cue.id,
        text: cue.normalizedText,
        ...(contextPrevious ? { contextPrevious } : {}),
        ...(contextNext ? { contextNext } : {}),
      },
    ];
  });
}

export function buildProviderRequest(input: {
  fingerprint: PlaybackFingerprint;
  requestId: string;
  batchId: string;
  profileId: string;
  profileRevision: number;
  endpointFingerprint: string;
  sourceLanguage: string;
  targetLanguage: string;
  targets: readonly FrozenTranslationTarget[];
}): TranslationBatchRequest {
  return {
    playerId: input.fingerprint.playerId,
    requestId: input.requestId,
    batchId: input.batchId,
    sessionId: input.fingerprint.sessionId,
    sessionEpoch: input.fingerprint.sessionEpoch,
    windowEpoch: input.fingerprint.windowEpoch,
    profileId: input.profileId,
    profileRevision: input.profileRevision,
    endpointFingerprint: input.endpointFingerprint,
    sourceLanguage: input.sourceLanguage,
    targetLanguage: input.targetLanguage,
    items: input.targets.map((target) => ({ ...target })),
  } as TranslationBatchRequest;
}
