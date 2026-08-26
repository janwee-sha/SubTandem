import { describe, expect, it } from "vitest";
import { parseAss } from "../../src/subtitles/ass.js";

describe("ASS Events parsing", () => {
  it("uses dynamic Format columns and preserves commas in Dialogue text", () => {
    const parsed = parseAss(
      "[Events]\nFormat: Start, End, Name, Text, Layer\nDialogue: 0:00:01.25,0:00:03.50,Alice,{\\i1}Hello, world{\\i0}\\NSecond line,0\n",
    );
    expect(parsed.warnings).toEqual([]);
    expect(parsed.cues[0]).toMatchObject({
      startMs: 1_250,
      endMs: 3_500,
      sourceText: "Alice: Hello, world\nSecond line",
      normalizedText: "Alice: Hello, world\nSecond line",
    });
  });

  it("skips malformed rows and sorts overlaps by time then source order", () => {
    const parsed = parseAss(
      "[Events]\nFormat: Layer, Start, End, Text\nDialogue: 0,bad,0:00:02.00,broken\nDialogue: 0,0:00:02.00,0:00:04.00,later\nDialogue: 0,0:00:01.00,0:00:03.00,earlier\n",
    );
    expect(parsed.cues.map((cue) => cue.sourceText)).toEqual(["earlier", "later"]);
    expect(parsed.warnings).toContain("ass:malformed-dialogue:1");
  });
});
