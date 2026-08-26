const BASE64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
const BASE64_INDEX: Record<string, number> = Object.fromEntries(
  [...BASE64].map((character, index) => [character, index]),
);

export function utf8Encode(input: string): Uint8Array {
  const output: number[] = [];
  for (let index = 0; index < input.length; index += 1) {
    let codePoint = input.charCodeAt(index);
    if (codePoint >= 0xd800 && codePoint <= 0xdbff) {
      const low = input.charCodeAt(index + 1);
      if (low < 0xdc00 || low > 0xdfff) throw new Error("Invalid UTF-16 surrogate pair");
      codePoint = 0x10000 + ((codePoint - 0xd800) << 10) + (low - 0xdc00);
      index += 1;
    } else if (codePoint >= 0xdc00 && codePoint <= 0xdfff) {
      throw new Error("Invalid UTF-16 surrogate pair");
    }

    if (codePoint <= 0x7f) output.push(codePoint);
    else if (codePoint <= 0x7ff) output.push(0xc0 | (codePoint >> 6), 0x80 | (codePoint & 0x3f));
    else if (codePoint <= 0xffff) {
      output.push(
        0xe0 | (codePoint >> 12),
        0x80 | ((codePoint >> 6) & 0x3f),
        0x80 | (codePoint & 0x3f),
      );
    } else {
      output.push(
        0xf0 | (codePoint >> 18),
        0x80 | ((codePoint >> 12) & 0x3f),
        0x80 | ((codePoint >> 6) & 0x3f),
        0x80 | (codePoint & 0x3f),
      );
    }
  }
  return Uint8Array.from(output);
}

export function utf8Decode(bytes: Uint8Array): string {
  let output = "";
  for (let index = 0; index < bytes.length;) {
    const first = bytes[index];
    if (first === undefined) break;
    let codePoint: number;
    let needed: number;
    let minimum: number;
    if (first <= 0x7f) {
      codePoint = first;
      needed = 0;
      minimum = 0;
    } else if (first >= 0xc2 && first <= 0xdf) {
      codePoint = first & 0x1f;
      needed = 1;
      minimum = 0x80;
    } else if (first >= 0xe0 && first <= 0xef) {
      codePoint = first & 0x0f;
      needed = 2;
      minimum = 0x800;
    } else if (first >= 0xf0 && first <= 0xf4) {
      codePoint = first & 0x07;
      needed = 3;
      minimum = 0x10000;
    } else {
      throw new Error("Malformed UTF-8 lead byte");
    }
    if (index + needed >= bytes.length) throw new Error("Truncated UTF-8 sequence");
    for (let offset = 1; offset <= needed; offset += 1) {
      const continuation = bytes[index + offset];
      if (continuation === undefined || (continuation & 0xc0) !== 0x80) {
        throw new Error("Malformed UTF-8 continuation byte");
      }
      codePoint = (codePoint << 6) | (continuation & 0x3f);
    }
    if (
      codePoint < minimum ||
      codePoint > 0x10ffff ||
      (codePoint >= 0xd800 && codePoint <= 0xdfff)
    ) {
      throw new Error("Invalid UTF-8 code point");
    }
    output += String.fromCodePoint(codePoint);
    index += needed + 1;
  }
  return output;
}

export function base64Encode(bytes: Uint8Array): string {
  let output = "";
  for (let index = 0; index < bytes.length; index += 3) {
    const a = bytes[index] ?? 0;
    const b = bytes[index + 1] ?? 0;
    const c = bytes[index + 2] ?? 0;
    const value = (a << 16) | (b << 8) | c;
    output += BASE64[(value >> 18) & 63] ?? "";
    output += BASE64[(value >> 12) & 63] ?? "";
    output += index + 1 < bytes.length ? (BASE64[(value >> 6) & 63] ?? "") : "=";
    output += index + 2 < bytes.length ? (BASE64[value & 63] ?? "") : "=";
  }
  return output;
}

export function base64Decode(input: string): Uint8Array {
  if (input.length === 0) return new Uint8Array();
  if (input.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(input)) {
    throw new Error("Malformed base64");
  }
  const padding = input.endsWith("==") ? 2 : input.endsWith("=") ? 1 : 0;
  if (input.slice(0, -padding || undefined).includes("="))
    throw new Error("Malformed base64 padding");
  const output = new Uint8Array((input.length / 4) * 3 - padding);
  let outputIndex = 0;
  for (let index = 0; index < input.length; index += 4) {
    const values = [0, 1, 2, 3].map((offset) => {
      const character = input[index + offset];
      return character === "=" ? 0 : character === undefined ? undefined : BASE64_INDEX[character];
    });
    if (values.some((value) => value === undefined)) throw new Error("Malformed base64 character");
    const value =
      ((values[0] ?? 0) << 18) |
      ((values[1] ?? 0) << 12) |
      ((values[2] ?? 0) << 6) |
      (values[3] ?? 0);
    if (outputIndex < output.length) output[outputIndex++] = (value >> 16) & 0xff;
    if (outputIndex < output.length) output[outputIndex++] = (value >> 8) & 0xff;
    if (outputIndex < output.length) output[outputIndex++] = value & 0xff;
  }
  return output;
}
