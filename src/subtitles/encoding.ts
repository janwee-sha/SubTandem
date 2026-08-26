import { utf8Decode } from "../domain/codec.js";

export interface DecodedSubtitle {
  text: string;
  encoding: "utf-8" | "utf-16le" | "utf-16be";
  bom: boolean;
  warnings: string[];
}

function decodeUtf16(bytes: Uint8Array, littleEndian: boolean): string {
  if (bytes.length % 2 !== 0) throw new Error("Truncated UTF-16 input");
  let output = "";
  for (let index = 0; index < bytes.length; index += 2) {
    const first = bytes[index] ?? 0;
    const second = bytes[index + 1] ?? 0;
    output += String.fromCharCode(littleEndian ? first | (second << 8) : (first << 8) | second);
  }
  // Validate surrogate pairing by round-tripping through the strict UTF-8 encoder's semantics.
  for (let index = 0; index < output.length; index += 1) {
    const code = output.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const low = output.charCodeAt(++index);
      if (low < 0xdc00 || low > 0xdfff) throw new Error("Malformed UTF-16 surrogate");
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      throw new Error("Malformed UTF-16 surrogate");
    }
  }
  return output;
}

export function decodeSubtitleBytes(bytes: Uint8Array): DecodedSubtitle | null {
  try {
    if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
      return { text: utf8Decode(bytes.slice(3)), encoding: "utf-8", bom: true, warnings: [] };
    }
    if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
      return {
        text: decodeUtf16(bytes.slice(2), true),
        encoding: "utf-16le",
        bom: true,
        warnings: [],
      };
    }
    if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
      return {
        text: decodeUtf16(bytes.slice(2), false),
        encoding: "utf-16be",
        bom: true,
        warnings: [],
      };
    }
    const text = utf8Decode(bytes);
    return {
      text,
      encoding: "utf-8",
      bom: false,
      warnings: text.includes("\u0000") ? ["encoding:unexpected-nul"] : [],
    };
  } catch {
    return null;
  }
}
