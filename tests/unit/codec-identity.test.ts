import { describe, expect, it } from "vitest";
import { base64Decode, base64Encode, utf8Decode, utf8Encode } from "../../src/domain/codec.js";
import { canonicalJson, sha256Hex } from "../../src/domain/identity.js";

describe("JavaScriptCore-safe codecs", () => {
  it("round-trips Unicode without browser globals", () => {
    const text = "字幕 👩🏽‍💻 café";
    expect(utf8Decode(utf8Encode(text))).toBe(text);
    expect(base64Decode(base64Encode(utf8Encode(text)))).toEqual(utf8Encode(text));
  });

  it("rejects malformed UTF-8 and base64", () => {
    expect(() => utf8Decode(Uint8Array.from([0xc0, 0xaf]))).toThrow();
    expect(() => base64Decode("not base64!")).toThrow();
  });
});

describe("canonical identities", () => {
  it("sorts object keys and preserves array order", () => {
    expect(canonicalJson({ z: 1, a: [2, { y: true, x: null }] })).toBe(
      '{"a":[2,{"x":null,"y":true}],"z":1}',
    );
  });

  it("produces stable SHA-256 hex", () => {
    expect(sha256Hex("abc")).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });
});
