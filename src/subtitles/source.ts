import { sha256Hex } from "../domain/identity.js";
import { parseAss } from "./ass.js";
import { decodeSubtitleBytes } from "./encoding.js";
import { parseSrt } from "./srt.js";
import type {
  ExtractedSubtitleResult,
  PreparedSubtitleSource,
  SubtitleSource,
  SubtitleTrackIdentity,
} from "./types.js";

export interface SubtitleTrackDescriptor {
  id: number;
  isExternal: boolean;
  title?: string;
  lang?: string;
}

export type SubtitleSourceResult =
  | { ok: true; source: SubtitleSource }
  | {
      ok: false;
      reason:
        "not-external" | "unreadable" | "unsupported-format" | "unsupported-encoding" | "empty";
    };

function detectFormat(title: string | undefined, text: string): "srt" | "ass" | null {
  const normalizedTitle = title?.toLowerCase() ?? "";
  if (normalizedTitle.endsWith(".srt")) return "srt";
  if (normalizedTitle.endsWith(".ass") || normalizedTitle.endsWith(".ssa")) return "ass";
  if (/^\s*\[Script Info\]/im.test(text) && /^\s*\[Events\]/im.test(text)) return "ass";
  if (/\d{1,2}:\d{2}:\d{2}[,.]\d{3}\s*-->/m.test(text)) return "srt";
  return null;
}

export function loadSubtitleSource(
  track: SubtitleTrackDescriptor,
  bytes: Uint8Array | null,
): SubtitleSourceResult {
  if (!track.isExternal) return { ok: false, reason: "not-external" };
  if (!bytes) return { ok: false, reason: "unreadable" };
  const decoded = decodeSubtitleBytes(bytes);
  if (!decoded) return { ok: false, reason: "unsupported-encoding" };
  const format = detectFormat(track.title, decoded.text);
  if (!format) return { ok: false, reason: "unsupported-format" };
  const parsed = format === "srt" ? parseSrt(decoded.text) : parseAss(decoded.text);
  if (parsed.cues.length === 0) return { ok: false, reason: "empty" };
  return {
    ok: true,
    source: {
      trackId: track.id,
      isExternal: true,
      format,
      contentHash: sha256Hex(bytes),
      trackLanguage: track.lang?.trim() || null,
      decode: {
        encoding: decoded.encoding,
        bom: decoded.bom,
        warnings: [...decoded.warnings, ...parsed.warnings],
      },
      cues: parsed.cues,
    },
  };
}

export function loadPreparedSubtitleSource(
  track: SubtitleTrackIdentity,
  bytes: Uint8Array,
  result: ExtractedSubtitleResult,
): PreparedSubtitleSource | null {
  if (
    track.origin !== "embedded" ||
    track.codec === "external" ||
    bytes.length !== result.byteCount ||
    sha256Hex(bytes) !== result.sha256
  )
    return null;
  const decoded = decodeSubtitleBytes(bytes);
  if (!decoded || decoded.encoding !== "utf-8") return null;
  const parsed = parseSrt(decoded.text);
  if (parsed.cues.length === 0 || parsed.cues.length !== result.cueCount) return null;
  return {
    trackId: track.trackId,
    origin: "embedded",
    codec: track.codec,
    contentHash: result.sha256,
    trackLanguage: track.language?.trim() || null,
    cues: parsed.cues,
  };
}
