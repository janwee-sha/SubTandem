import {
  loadSubtitleSource,
  type SubtitleSourceResult,
  type SubtitleTrackDescriptor,
} from "../../subtitles/source.js";
import { utf8Encode } from "../../domain/codec.js";
import type {
  EmbeddedSubtitleCodec,
  MediaSessionIdentity,
  SubtitleTrackIdentity,
} from "../../subtitles/types.js";

export interface SubtitleSourcePort {
  selectedTrack(): SubtitleTrackDescriptor | null;
  readBinary(path: string): Uint8Array | null;
}

export function readSelectedSubtitle(port: SubtitleSourcePort): SubtitleSourceResult {
  const track = port.selectedTrack();
  if (!track) return { ok: false, reason: "unreadable" };
  if (!track.isExternal) return { ok: false, reason: "not-external" };
  return loadSubtitleSource(track, port.readBinary(`@sub/${track.id}`));
}

export interface SubtitleSelectionSnapshot {
  playerId: string;
  mediaEpoch: number;
  mediaUrl: string;
  isNetworkResource: boolean;
  selectedTrackId: number | null;
  tracks: unknown[];
}

export type SubtitleSelectionClassification =
  | { kind: "none"; state: "emptyOrUnreadable" }
  | { kind: "external"; track: SubtitleTrackIdentity }
  | { kind: "embedded"; media: MediaSessionIdentity; track: SubtitleTrackIdentity }
  | {
      kind: "unsupported";
      state: "unsupportedType" | "remoteUnsupported" | "emptyOrUnreadable";
      track?: SubtitleTrackIdentity;
    };

interface MpvSubtitleTrackNode {
  type?: unknown;
  id?: unknown;
  selected?: unknown;
  "main-selection"?: unknown;
  external?: unknown;
  codec?: unknown;
  "ff-index"?: unknown;
  "src-id"?: unknown;
  lang?: unknown;
  title?: unknown;
}

export function normalizeSubtitleCodec(value: unknown): EmbeddedSubtitleCodec | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  if (normalized === "srt") return "subrip";
  if (
    normalized === "subrip" ||
    normalized === "ass" ||
    normalized === "ssa" ||
    normalized === "mov_text"
  )
    return normalized;
  return null;
}

function localPath(mediaUrl: string): string | null {
  try {
    if (!mediaUrl.startsWith("file://")) return mediaUrl.startsWith("/") ? mediaUrl : null;
    const remainder = mediaUrl.slice("file://".length);
    const pathText = remainder.startsWith("/")
      ? remainder
      : remainder.startsWith("localhost/")
        ? remainder.slice("localhost".length)
        : "";
    const path = decodeURIComponent(pathText);
    return path.startsWith("/") ? path : null;
  } catch {
    return null;
  }
}

function exactTrackIdentity(node: MpvSubtitleTrackNode): SubtitleTrackIdentity | null {
  if (!Number.isInteger(node.id)) return null;
  const trackId = node.id as number;
  const language = typeof node.lang === "string" && node.lang.trim() ? node.lang.trim() : undefined;
  const title = typeof node.title === "string" && node.title.trim() ? node.title.trim() : undefined;
  if (node.external === true)
    return {
      trackId,
      origin: "external",
      codec: "external",
      ...(language ? { language } : {}),
      ...(title ? { title } : {}),
    };
  const codec = normalizeSubtitleCodec(node.codec);
  if (!codec || !Number.isInteger(node["ff-index"]) || (node["ff-index"] as number) < 0)
    return null;
  const sourceId = node["src-id"];
  if (sourceId !== undefined && sourceId !== null && !Number.isInteger(sourceId)) return null;
  return {
    trackId,
    origin: "embedded",
    codec,
    ffIndex: node["ff-index"] as number,
    ...(typeof sourceId === "number" ? { sourceId } : {}),
    ...(language ? { language } : {}),
    ...(title ? { title } : {}),
  };
}

export function classifySubtitleSelection(
  snapshot: SubtitleSelectionSnapshot,
): SubtitleSelectionClassification {
  if (snapshot.selectedTrackId === null) return { kind: "none", state: "emptyOrUnreadable" };
  const matches = snapshot.tracks.filter((value) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return false;
    const node = value as MpvSubtitleTrackNode;
    return (
      node.type === "sub" &&
      node.id === snapshot.selectedTrackId &&
      node.selected === true &&
      node["main-selection"] === 0
    );
  }) as MpvSubtitleTrackNode[];
  if (matches.length !== 1) return { kind: "none", state: "emptyOrUnreadable" };
  const node = matches[0]!;
  const identity = exactTrackIdentity(node);
  if (node.external === true) {
    return identity
      ? { kind: "external", track: identity }
      : { kind: "none", state: "emptyOrUnreadable" };
  }
  if (snapshot.isNetworkResource) return { kind: "unsupported", state: "remoteUnsupported" };
  if (!identity || identity.origin !== "embedded")
    return { kind: "unsupported", state: "unsupportedType" };
  const path = localPath(snapshot.mediaUrl);
  if (!path) return { kind: "unsupported", state: "emptyOrUnreadable", track: identity };
  return {
    kind: "embedded",
    media: {
      playerId: snapshot.playerId,
      mediaEpoch: snapshot.mediaEpoch,
      localPath: path,
      isNetworkResource: false,
    },
    track: identity,
  };
}

export class IinaSubtitleSourcePort implements SubtitleSourcePort {
  constructor(
    private readonly subtitle: IINA.API.SubtitleAPI,
    private readonly file: IINA.API.File,
    private readonly core?: IINA.API.Core,
    private readonly mpv?: IINA.API.MPV,
    private readonly playerId = "player",
    private readonly mediaEpoch: number | (() => number) = 0,
  ) {}

  selectionSnapshot(): SubtitleSelectionSnapshot | null {
    if (!this.core || !this.mpv) return null;
    const tracks = this.mpv.getNative<unknown>("track-list");
    return {
      playerId: this.playerId,
      mediaEpoch: typeof this.mediaEpoch === "function" ? this.mediaEpoch() : this.mediaEpoch,
      mediaUrl: this.core.status.url,
      isNetworkResource: this.core.status.isNetworkResource,
      selectedTrackId: this.subtitle.id,
      tracks: Array.isArray(tracks) ? tracks : [],
    };
  }

  selectedTrack(): SubtitleTrackDescriptor | null {
    const id = this.subtitle.id;
    if (id === null) return null;
    let track = this.subtitle.tracks.find((candidate) => candidate.id === id);
    if (!track) {
      try {
        if (this.subtitle.currentTrack?.id === id) track = this.subtitle.currentTrack;
      } catch {
        /* IINA can expose the selected ID before currentTrack is ready. */
      }
    }
    if (!track) return null;
    return {
      id: track.id,
      isExternal: track.isExternal,
      ...(track.title === null ? {} : { title: track.title }),
      ...(track.lang === null ? {} : { lang: track.lang }),
    };
  }

  readBinary(path: string): Uint8Array | null {
    let handle: IINA.API.FileHandle | null = null;
    try {
      handle = this.file.handle(path, "read");
      const bytes = handle.readToEnd();
      if (bytes) return bytes;
    } catch {
      /* Fall through to IINA's text reader for UTF-8 subtitles. */
    } finally {
      handle?.close();
    }
    try {
      const text = this.file.read(path);
      return typeof text === "string" ? utf8Encode(text) : null;
    } catch {
      return null;
    }
  }
}
