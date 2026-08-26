import type { SubtitleCue, SubtitleParseResult } from "./types.js";

function parseTimestamp(input: string): number | null {
  const match = input.trim().match(/^(\d+):(\d{2}):(\d{2})[.](\d{1,2})$/);
  if (!match) return null;
  const [, hours = "0", minutes = "0", seconds = "0", centiseconds = "0"] = match;
  const values = [hours, minutes, seconds, centiseconds].map(Number);
  if (values.some((value) => !Number.isInteger(value)) || values[1]! > 59 || values[2]! > 59)
    return null;
  return (
    (values[0]! * 3_600 + values[1]! * 60 + values[2]!) * 1_000 +
    values[3]! * (centiseconds.length === 1 ? 100 : 10)
  );
}

function splitDialogue(value: string, fieldCount: number, textIndex: number): string[] | null {
  const before: string[] = [];
  let remaining = value;
  for (let index = 0; index < textIndex; index += 1) {
    const separator = remaining.indexOf(",");
    if (separator < 0) return null;
    before.push(remaining.slice(0, separator));
    remaining = remaining.slice(separator + 1);
  }
  const after: string[] = [];
  for (let index = fieldCount - 1; index > textIndex; index -= 1) {
    const separator = remaining.lastIndexOf(",");
    if (separator < 0) return null;
    after.unshift(remaining.slice(separator + 1));
    remaining = remaining.slice(0, separator);
  }
  return [...before, remaining, ...after];
}

function visibleText(input: string): string {
  return input
    .replace(/\{[^}]*\}/g, "")
    .replace(/\\[Nn]/g, "\n")
    .replace(/\\h/g, " ")
    .trim();
}

export function parseAss(input: string): SubtitleParseResult {
  const lines = input
    .replace(/^\ufeff/, "")
    .replace(/\r\n?/g, "\n")
    .split("\n");
  let inEvents = false;
  let format: string[] | null = null;
  const cues: SubtitleCue[] = [];
  const warnings: string[] = [];
  let dialogueIndex = 0;
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (/^\[Events\]$/i.test(line)) {
      inEvents = true;
      continue;
    }
    if (/^\[.*\]$/.test(line)) {
      inEvents = false;
      continue;
    }
    if (!inEvents) continue;
    if (/^Format:/i.test(line)) {
      format = line
        .slice(line.indexOf(":") + 1)
        .split(",")
        .map((field) => field.trim().toLowerCase());
      continue;
    }
    if (!/^Dialogue:/i.test(line)) continue;
    dialogueIndex += 1;
    if (!format) {
      warnings.push(`ass:missing-format:${dialogueIndex}`);
      continue;
    }
    const textIndex = format.indexOf("text");
    const fields =
      textIndex < 0
        ? null
        : splitDialogue(line.slice(line.indexOf(":") + 1).trim(), format.length, textIndex);
    const get = (name: string): string => fields?.[format!.indexOf(name)]?.trim() ?? "";
    const startMs = parseTimestamp(get("start"));
    const endMs = parseTimestamp(get("end"));
    const text = visibleText(get("text"));
    const speaker = get("name");
    if (!fields || startMs === null || endMs === null || endMs < startMs || !text) {
      warnings.push(`ass:malformed-dialogue:${dialogueIndex}`);
      continue;
    }
    const sourceText = speaker ? `${speaker}: ${text}` : text;
    cues.push({
      id: `ass:${dialogueIndex - 1}:${startMs}:${endMs}`,
      index: dialogueIndex - 1,
      startMs,
      endMs,
      sourceText,
      normalizedText: sourceText,
    });
  }
  cues.sort((left, right) => left.startMs - right.startMs || left.index - right.index);
  return { cues, warnings };
}
