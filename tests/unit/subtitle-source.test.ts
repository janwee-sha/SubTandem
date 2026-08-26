import { describe, expect, it } from "vitest";
import { utf8Encode } from "../../src/domain/codec.js";
import {
  classifySubtitleSelection,
  IinaSubtitleSourcePort,
  normalizeSubtitleCodec,
  readSelectedSubtitle,
} from "../../src/adapters/iina/subtitle-source.js";
import { loadSubtitleSource } from "../../src/subtitles/source.js";

describe("selected subtitle source", () => {
  const content = "1\n00:00:01,000 --> 00:00:02,000\nHello\n";

  it("requires an external readable SRT/ASS track and hashes decoded content", () => {
    const loaded = loadSubtitleSource(
      { id: 7, isExternal: true, title: "movie.srt", lang: "en-US" },
      Uint8Array.from([0xef, 0xbb, 0xbf, ...utf8Encode(content)]),
    );
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    expect(loaded.source).toMatchObject({ trackId: 7, format: "srt", trackLanguage: "en-US" });
    expect(loaded.source.decode).toMatchObject({ encoding: "utf-8", bom: true });
    expect(loaded.source.contentHash).toMatch(/^[a-f0-9]{64}$/);
    expect(loaded.source.cues).toHaveLength(1);
  });

  it("returns safe unsupported results for embedded, unreadable, malformed and unknown tracks", () => {
    expect(
      loadSubtitleSource({ id: 1, isExternal: false, title: "a.srt" }, utf8Encode(content)),
    ).toEqual({ ok: false, reason: "not-external" });
    expect(loadSubtitleSource({ id: 1, isExternal: true, title: "a.srt" }, null)).toEqual({
      ok: false,
      reason: "unreadable",
    });
    expect(
      loadSubtitleSource({ id: 1, isExternal: true, title: "a.vtt" }, utf8Encode("WEBVTT")),
    ).toEqual({ ok: false, reason: "unsupported-format" });
    expect(
      loadSubtitleSource(
        { id: 1, isExternal: true, title: "a.srt" },
        Uint8Array.from([0xc0, 0xaf]),
      ),
    ).toEqual({ ok: false, reason: "unsupported-encoding" });
  });

  it("recovers from lagging track lists and unavailable binary handles using IINA's current track and text read", () => {
    const subtitle = {
      id: 7,
      tracks: [],
      currentTrack: {
        id: 7,
        title: "movie.srt",
        lang: "en",
        isExternal: true,
      },
    } as unknown as IINA.API.SubtitleAPI;
    const file = {
      handle: () => {
        throw new Error("binary handle not ready");
      },
      read: (path: string) => (path === "@sub/7" ? content : undefined),
    } as unknown as IINA.API.File;

    const loaded = readSelectedSubtitle(new IinaSubtitleSourcePort(subtitle, file));
    expect(loaded.ok).toBe(true);
    if (loaded.ok) expect(loaded.source).toMatchObject({ trackId: 7, format: "srt" });
  });

  it("keeps the external @sub path and never reads it for an embedded track", () => {
    const paths: string[] = [];
    const external = readSelectedSubtitle({
      selectedTrack: () => ({ id: 7, isExternal: true, title: "movie.srt", lang: "en" }),
      readBinary: (path) => {
        paths.push(path);
        return utf8Encode(content);
      },
    });
    expect(external.ok).toBe(true);
    expect(paths).toEqual(["@sub/7"]);

    const embedded = readSelectedSubtitle({
      selectedTrack: () => ({ id: 8, isExternal: false, title: "embedded" }),
      readBinary: (path) => {
        paths.push(path);
        return utf8Encode(content);
      },
    });
    expect(embedded).toEqual({ ok: false, reason: "not-external" });
    expect(paths).toEqual(["@sub/7"]);
  });

  it.each([
    ["srt", "subrip"],
    ["subrip", "subrip"],
    ["ass", "ass"],
    ["ssa", "ssa"],
    ["mov_text", "mov_text"],
  ] as const)("normalizes supported codec %s", (input, expected) => {
    expect(normalizeSubtitleCodec(input)).toBe(expected);
  });

  it("classifies only the unique selected main track by exact stream identity", () => {
    const result = classifySubtitleSelection({
      playerId: "player-A",
      mediaEpoch: 4,
      mediaUrl: "file:///private/media/movie.mkv",
      isNetworkResource: false,
      selectedTrackId: 7,
      tracks: [
        {
          type: "sub",
          id: 7,
          selected: true,
          "main-selection": 0,
          external: false,
          codec: "ass",
          "ff-index": 3,
          "src-id": 12,
          lang: "en",
          title: "English",
        },
        {
          type: "sub",
          id: 8,
          selected: false,
          "main-selection": 0,
          external: false,
          codec: "ass",
          "ff-index": 4,
          "src-id": 13,
          lang: "en",
          title: "English",
        },
      ],
    });

    expect(result).toMatchObject({
      kind: "embedded",
      media: { playerId: "player-A", mediaEpoch: 4, localPath: "/private/media/movie.mkv" },
      track: { trackId: 7, codec: "ass", ffIndex: 3, sourceId: 12 },
    });
  });

  it("fails closed for missing, ambiguous, remote, graphic, unknown, and conflicting tracks", () => {
    const base = {
      playerId: "player-A",
      mediaEpoch: 1,
      mediaUrl: "file:///private/media/movie.mkv",
      isNetworkResource: false,
      selectedTrackId: 7,
    };
    const graphic = (codec: string) => ({
      type: "sub",
      id: 7,
      selected: true,
      "main-selection": 0,
      external: false,
      codec,
      "ff-index": 3,
      "src-id": 12,
    });

    expect(classifySubtitleSelection({ ...base, selectedTrackId: null, tracks: [] })).toEqual({
      kind: "none",
      state: "emptyOrUnreadable",
    });
    expect(
      classifySubtitleSelection({ ...base, tracks: [graphic("ass"), graphic("ass")] }),
    ).toEqual({ kind: "none", state: "emptyOrUnreadable" });
    for (const codec of ["hdmv_pgs_subtitle", "dvd_subtitle", "dvb_subtitle", "unknown"])
      expect(classifySubtitleSelection({ ...base, tracks: [graphic(codec)] })).toEqual({
        kind: "unsupported",
        state: "unsupportedType",
      });
    expect(
      classifySubtitleSelection({
        ...base,
        mediaUrl: "https://example.test/movie.mkv",
        isNetworkResource: true,
        tracks: [graphic("ass")],
      }),
    ).toEqual({ kind: "unsupported", state: "remoteUnsupported" });
    expect(
      classifySubtitleSelection({
        ...base,
        tracks: [{ ...graphic("ass"), "ff-index": "3" }],
      }),
    ).toEqual({ kind: "unsupported", state: "unsupportedType" });
    expect(
      classifySubtitleSelection({
        ...base,
        tracks: [{ ...graphic("ass"), "src-id": "12" }],
      }),
    ).toEqual({ kind: "unsupported", state: "unsupportedType" });
  });
});
