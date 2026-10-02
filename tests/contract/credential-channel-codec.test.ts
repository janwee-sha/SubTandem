import { afterEach, describe, expect, it, vi } from "vitest";
import vectors from "../fixtures/credentials/channel-vectors.json";
import {
  CREDENTIAL_LIMITS,
  credentialArray,
  credentialBase64,
  credentialDecode,
  credentialHandshakeAAD,
  credentialKeyInfo,
  credentialNonce,
  credentialOperationAAD,
  credentialText,
  credentialUtf8,
  parseCredentialEnvelope,
  parseCredentialOffer,
  parseCredentialSnapshot,
} from "../../shared/credential-protocol.js";
import type {
  CredentialDirection,
  CredentialOperationContext,
} from "../../shared/credential-protocol.js";
import {
  SidebarCredentialChannel,
  deriveCredentialKey,
  sealCredentialBytes,
  openCredentialBytes,
  credentialSnapshotDigest,
} from "../../ui/credential-channel.js";

const decode = (value: string) => credentialDecode(value, 32768);
const offer = parseCredentialOffer(vectors.offer);
const context = vectors.context as CredentialOperationContext;

describe("credential production codec", () => {
  it.each(vectors.vectors)("matches independent Node/CryptoKit $direction vectors", (v) => {
    const direction = v.direction as CredentialDirection;
    const info = credentialKeyInfo(offer, direction);
    expect(credentialBase64(info)).toBe(v.info);
    const key = deriveCredentialKey(
      decode(vectors.clientPrivateKey),
      decode(offer.helperPublicKey),
      decode(offer.salt),
      info,
    );
    expect(credentialBase64(key)).toBe(v.key);
    expect(
      deriveCredentialKey(
        decode(vectors.helperPrivateKey),
        decode(offer.clientPublicKey),
        decode(offer.salt),
        info,
      ),
    ).toEqual(key);
    const aad = credentialOperationAAD(offer, direction, 1, context);
    expect(credentialBase64(aad)).toBe(v.aad);
    expect(
      credentialBase64(sealCredentialBytes(key, credentialNonce(1), decode(v.plaintext), aad)),
    ).toBe(v.sealed);
    expect(openCredentialBytes(key, credentialNonce(1), decode(v.sealed), aad)).toEqual(
      decode(v.plaintext),
    );
    expect(
      credentialBase64(
        sealCredentialBytes(
          key,
          credentialNonce(0),
          new Uint8Array(),
          credentialHandshakeAAD(offer, direction),
        ),
      ),
    ).toBe(v.handshakeSealed);
  });
  it("hashes the exact snapshot bytes and encodes UTF-8 without JSON quoting", () => {
    expect(credentialSnapshotDigest(decode(vectors.snapshotBytes))).toBe(context.snapshotDigest);
    const snapshot = credentialText(decode(vectors.snapshotBytes));
    expect(parseCredentialSnapshot(JSON.parse(snapshot)).model).toContain("雪");
    expect(credentialSnapshotDigest(credentialUtf8(` ${snapshot}`))).not.toBe(
      context.snapshotDigest,
    );
    expect(credentialText(credentialArray([null, 9007199254740991, "雪/"]))).toBe(
      '[null,9007199254740991,"雪/"]',
    );
  });
  it.each(["AA", "AB==", "AAA=\n", "A===", "AA-_", "AAAA===="])(
    "rejects noncanonical base64 %s",
    (value) => {
      expect(() => credentialDecode(value, 128)).toThrow();
    },
  );
  it("rejects extra fields, unsafe integers, oversized payloads and invalid UTF-8", () => {
    const frame = {
      protocolVersion: 2,
      channelId: offer.channelId,
      helperSessionId: offer.helperSessionId,
      sequence: 1,
      context,
      snapshotBytes: vectors.snapshotBytes,
      sealedPayload: vectors.vectors[0]!.sealed,
    };
    expect(parseCredentialEnvelope(frame)).toEqual(frame);
    expect(() => parseCredentialEnvelope({ ...frame, apiKey: "synthetic" })).toThrow();
    expect(() => parseCredentialEnvelope({ ...frame, sequence: 1.5 })).toThrow();
    expect(() =>
      parseCredentialEnvelope({
        ...frame,
        context: { ...context, submitEpoch: Number.MAX_SAFE_INTEGER + 1 },
      }),
    ).toThrow();
    expect(() =>
      parseCredentialEnvelope({
        ...frame,
        sealedPayload: credentialBase64(new Uint8Array(CREDENTIAL_LIMITS.sealedBytes + 1)),
      }),
    ).toThrow();
    expect(() => credentialText(Uint8Array.of(0xc0, 0x80))).toThrow();
    expect(() =>
      parseCredentialSnapshot({
        ...JSON.parse(credentialText(decode(vectors.snapshotBytes))),
        apiKey: "synthetic",
      }),
    ).toThrow();
  });
  it("rejects wrong point encoding, authentication tags and AAD", () => {
    const v = vectors.vectors[0]!;
    expect(() =>
      deriveCredentialKey(
        decode(vectors.clientPrivateKey),
        new Uint8Array(65),
        decode(offer.salt),
        decode(v.info),
      ),
    ).toThrow();
    const sealed = decode(v.sealed);
    sealed[sealed.length - 1]! ^= 1;
    expect(() =>
      openCredentialBytes(decode(v.key), credentialNonce(1), sealed, decode(v.aad)),
    ).toThrow();
    expect(() =>
      openCredentialBytes(
        decode(v.key),
        credentialNonce(1),
        decode(v.sealed),
        credentialUtf8("wrong"),
      ),
    ).toThrow();
  });
});

import type {
  CredentialChannelOffer,
  CredentialOperationSnapshot,
} from "../../shared/credential-protocol.js";

afterEach(() => vi.useRealTimers());

function establishSidebarChannel() {
  const channel = new SidebarCredentialChannel(
    offer.sidebarInstanceId,
    offer.drawerId,
    offer.sourceProfile,
  );
  const negotiated: CredentialChannelOffer = {
    ...offer,
    ...channel.opening,
    sourceProfile:
      channel.opening.sourceProfile === null
        ? null
        : {
            endpointFingerprint: channel.opening.sourceProfile.endpointFingerprint,
            profileRevision: channel.opening.sourceProfile.profileRevision,
            profileId: channel.opening.sourceProfile.profileId,
          },
  };
  const confirmation = channel.acceptOffer(negotiated);
  const inbound = deriveCredentialKey(
    decode(vectors.helperPrivateKey),
    decode(negotiated.clientPublicKey),
    decode(negotiated.salt),
    credentialKeyInfo(negotiated, "sidebar-to-helper"),
  );
  const outbound = deriveCredentialKey(
    decode(vectors.helperPrivateKey),
    decode(negotiated.clientPublicKey),
    decode(negotiated.salt),
    credentialKeyInfo(negotiated, "helper-to-sidebar"),
  );
  expect(
    openCredentialBytes(
      inbound,
      credentialNonce(0),
      decode(confirmation.sealedPayload),
      credentialHandshakeAAD(negotiated, "sidebar-to-helper"),
    ),
  ).toEqual(new Uint8Array());
  channel.confirm({
    ...confirmation,
    sealedPayload: credentialBase64(
      sealCredentialBytes(
        outbound,
        credentialNonce(0),
        new Uint8Array(),
        credentialHandshakeAAD(negotiated, "helper-to-sidebar"),
      ),
    ),
  });
  const snapshot = JSON.parse(
    credentialText(decode(vectors.snapshotBytes)),
  ) as CredentialOperationSnapshot;
  const metadata = { ...context, expiresAtMs: Date.now() + 10000 };
  return { channel, negotiated, inbound, outbound, snapshot, metadata };
}

describe("Sidebar credential session", () => {
  it("freezes trimmed UTF-8 input, uses distinct nonces and accepts bounded reverse-order responses", () => {
    const h = establishSidebarChannel();
    const first = h.channel.seal("  synthetic-雪  ", h.metadata, h.snapshot);
    const second = h.channel.seal("", { ...h.metadata, requestId: "second" }, h.snapshot);
    expect(first.sequence).toBe(1);
    expect(second.sequence).toBe(2);
    expect(
      credentialText(
        openCredentialBytes(
          h.inbound,
          credentialNonce(1),
          decode(first.sealedPayload),
          credentialOperationAAD(h.negotiated, "sidebar-to-helper", 1, first.context),
        ),
      ),
    ).toBe("synthetic-雪");
    const respond = (frame: typeof first, sequence: number) => ({
      ...frame,
      context: Object.fromEntries(Object.entries(frame.context).reverse()),
      sequence,
      sealedPayload: credentialBase64(
        sealCredentialBytes(
          h.outbound,
          credentialNonce(sequence),
          credentialUtf8("synthetic-response"),
          credentialOperationAAD(h.negotiated, "helper-to-sidebar", sequence, frame.context),
        ),
      ),
    });
    expect(h.channel.open(respond(second, 2))).toBe("synthetic-response");
    expect(h.channel.open(respond(first, 1))).toBe("synthetic-response");
    expect(() => h.channel.open(respond(first, 1))).toThrow();
    expect(Object.isFrozen(first.context)).toBe(true);
  });
  it("does not accept an unauthenticated offer, closed or expired sessions, or oversized UTF-8 keys", () => {
    const pending = new SidebarCredentialChannel(
      offer.sidebarInstanceId,
      offer.drawerId,
      offer.sourceProfile,
    );
    pending.acceptOffer({ ...offer, ...pending.opening });
    const snapshot = JSON.parse(
      credentialText(decode(vectors.snapshotBytes)),
    ) as CredentialOperationSnapshot;
    expect(() => pending.seal("value", context, snapshot)).toThrow();
    pending.close();
    expect(() => pending.acceptOffer(offer)).toThrow();
    const h = establishSidebarChannel();
    expect(() => h.channel.seal("雪".repeat(2731), h.metadata, h.snapshot)).toThrow(
      "credential-too-large",
    );
    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + 300001);
    expect(() => h.channel.seal("value", h.metadata, h.snapshot)).toThrow(
      "credential-channel-expired",
    );
  });
  it("handles a full one-MiB snapshot base64 boundary without regex stack exhaustion", () => {
    const bytes = new Uint8Array(CREDENTIAL_LIMITS.documentBytes);
    const encoded = credentialBase64(bytes);
    expect(credentialDecode(encoded, CREDENTIAL_LIMITS.documentBytes)).toEqual(bytes);
    expect(() => credentialDecode(encoded, CREDENTIAL_LIMITS.documentBytes - 1)).toThrow();
  });
});
