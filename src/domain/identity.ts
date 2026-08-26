import { sha256 } from "@noble/hashes/sha2.js";
import { utf8Encode } from "./codec.js";
import type { Sha256Hex } from "./types.js";

function canonicalize(value: unknown): string {
  if (value === null || typeof value === "boolean" || typeof value === "string") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("Canonical JSON requires finite numbers");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    const entries = Object.keys(record)
      .sort()
      .map((key) => {
        if (record[key] === undefined) throw new Error("Canonical JSON rejects undefined");
        return `${JSON.stringify(key)}:${canonicalize(record[key])}`;
      });
    return `{${entries.join(",")}}`;
  }
  throw new Error("Unsupported canonical JSON value");
}

export function canonicalJson(value: unknown): string {
  return canonicalize(value);
}

export function sha256Hex(value: string | Uint8Array): Sha256Hex {
  const bytes = typeof value === "string" ? utf8Encode(value) : value;
  return [...sha256(bytes)].map((byte) => byte.toString(16).padStart(2, "0")).join("") as Sha256Hex;
}

export function identityHash(value: unknown): Sha256Hex {
  return sha256Hex(canonicalJson(value));
}
