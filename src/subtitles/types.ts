import type { Sha256Hex } from "../domain/types.js";

export const EMBEDDED_SUBTITLE_CODECS = ["subrip", "ass", "ssa", "mov_text"] as const;

export type EmbeddedSubtitleCodec = (typeof EMBEDDED_SUBTITLE_CODECS)[number];

export interface SubtitleTrackIdentity {
  trackId: number;
  origin: "external" | "embedded";
  codec: EmbeddedSubtitleCodec | "external";
  ffIndex?: number;
  sourceId?: number;
  language?: string;
  title?: string;
}

export interface MediaSessionIdentity {
  playerId: string;
  mediaEpoch: number;
  localPath: string;
  isNetworkResource: boolean;
}

export type SubtitlePreparationState =
  | "preparing"
  | "ready"
  | "unsupportedType"
  | "remoteUnsupported"
  | "emptyOrUnreadable"
  | "timedOut"
  | "failed"
  | "invalidated";

export interface SubtitlePreparationAttempt {
  attemptId: string;
  mediaEpoch: number;
  trackIdentity: SubtitleTrackIdentity;
  startedAt: number;
  deadlineAt: number;
  status: SubtitlePreparationState;
  jobId?: string;
}

export interface ExtractionJob {
  jobId: string;
  mediaPath: string;
  streamIdentity: {
    ffIndex: number;
    sourceId: number | null;
    codec: EmbeddedSubtitleCodec;
  };
  resultId?: string;
  cueCount?: number;
  byteCount?: number;
  sha256?: Sha256Hex;
  state: "created" | "running" | "ready" | "cancelled" | "failed" | "released";
}

export interface ExtractedSubtitleResult {
  jobId: string;
  state: "ready";
  resultId: string;
  format: "srt";
  cueCount: number;
  byteCount: number;
  sha256: Sha256Hex;
}

export interface PreparedSubtitleSource {
  trackId: number;
  origin: "embedded";
  codec: EmbeddedSubtitleCodec;
  contentHash: Sha256Hex;
  trackLanguage: string | null;
  cues: SubtitleCue[];
}

export interface SourcePreparationView {
  state: SubtitlePreparationState;
  origin: "embedded";
  codec?: EmbeddedSubtitleCodec;
  cueCount?: number;
  canRetry: boolean;
  canReselect: boolean;
}

export interface SubtitleCue {
  id: string;
  index: number;
  startMs: number;
  endMs: number;
  sourceText: string;
  normalizedText: string;
  contextText?: string;
}

export interface SubtitleParseResult {
  cues: SubtitleCue[];
  warnings: string[];
}

export interface SubtitleSource {
  trackId: number;
  isExternal: true;
  format: "srt" | "ass";
  contentHash: Sha256Hex;
  trackLanguage: string | null;
  decode: { encoding: string; bom: boolean; warnings: string[] };
  cues: SubtitleCue[];
}
