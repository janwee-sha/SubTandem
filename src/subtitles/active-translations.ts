import type { SubtitleCue } from "./types.js";

export function selectActiveTranslations(
  cues: readonly SubtitleCue[],
  translations: ReadonlyMap<string, string>,
  positionMs: number | null,
): string[] {
  if (positionMs === null || !Number.isFinite(positionMs)) return [];
  const active: string[] = [];
  for (const cue of cues) {
    if (cue.endMs <= cue.startMs || positionMs < cue.startMs || positionMs >= cue.endMs) continue;
    const translation = translations.get(cue.id);
    if (!translation?.trim()) continue;
    active.push(translation);
  }
  return active;
}
