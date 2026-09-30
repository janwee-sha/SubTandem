import { p256 } from "@noble/curves/nist.js";
import { gcm } from "@noble/ciphers/aes.js";
import { hkdf } from "@noble/hashes/hkdf.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import {
  CREDENTIAL_LIMITS,
  CredentialProtocolError,
  credentialAssert,
  credentialBase64,
  credentialDecode,
  credentialHandshakeAAD,
  credentialKeyInfo,
  credentialNonce,
  credentialOperationAAD,
  credentialSourceArray,
  credentialText,
  credentialUtf8,
  parseCredentialEnvelope,
  parseCredentialHandshake,
  parseCredentialOffer,
  parseCredentialSnapshot,
  parseCredentialContext,
} from "../shared/credential-protocol.js";
import type {
  CredentialChannelOffer,
  CredentialChannelOpen,
  CredentialEnvelope,
  CredentialHandshake,
  CredentialOperationContext,
  CredentialOperationSnapshot,
  CredentialSourceProfile,
} from "../shared/credential-protocol.js";

export function deriveCredentialKey(
  privateKey: Uint8Array,
  publicKey: Uint8Array,
  salt: Uint8Array,
  info: Uint8Array,
): Uint8Array {
  credentialAssert(
    privateKey.length === 32 && publicKey.length === 65 && publicKey[0] === 4 && salt.length === 32,
  );
  let shared: Uint8Array | undefined;
  try {
    shared = p256.getSharedSecret(privateKey, publicKey, false);
    return hkdf(sha256, shared.subarray(1, 33), salt, info, 32);
  } catch {
    throw new CredentialProtocolError("credential-authentication-failed");
  } finally {
    shared?.fill(0);
  }
}
export function sealCredentialBytes(
  key: Uint8Array,
  nonce: Uint8Array,
  value: Uint8Array,
  aad: Uint8Array,
): Uint8Array {
  credentialAssert(key.length === 32 && nonce.length === 12);
  credentialAssert(value.length <= CREDENTIAL_LIMITS.keyBytes, "credential-too-large");
  return gcm(key, nonce, aad).encrypt(value);
}
export function openCredentialBytes(
  key: Uint8Array,
  nonce: Uint8Array,
  sealed: Uint8Array,
  aad: Uint8Array,
): Uint8Array {
  credentialAssert(
    key.length === 32 &&
      nonce.length === 12 &&
      sealed.length >= 16 &&
      sealed.length <= CREDENTIAL_LIMITS.sealedBytes,
  );
  try {
    const plaintext = gcm(key, nonce, aad).decrypt(sealed);
    if (plaintext.length > CREDENTIAL_LIMITS.keyBytes) {
      plaintext.fill(0);
      throw new CredentialProtocolError("credential-too-large");
    }
    return plaintext;
  } catch {
    throw new CredentialProtocolError("credential-authentication-failed");
  }
}
export function credentialSnapshotDigest(bytes: Uint8Array): string {
  return bytesToHex(sha256(bytes));
}
export function credentialRandomId(): string {
  return bytesToHex(crypto.getRandomValues(new Uint8Array(16)));
}

export class SidebarCredentialChannel {
  readonly opening: CredentialChannelOpen;
  private privateKey = new Uint8Array(32);
  private sendKey: Uint8Array | null = null;
  private receiveKey: Uint8Array | null = null;
  private offer: CredentialChannelOffer | null = null;
  private ready = false;
  private closed = false;
  private nextSequence = 1;
  private received = new Set<number>();
  private highestReceived = 0;
  private messageCount = 0;
  private lastActivity = Date.now();
  private pending = new Map<string, CredentialEnvelope>();

  constructor(
    sidebarInstanceId: string,
    drawerId: string,
    sourceProfile: CredentialSourceProfile | null,
  ) {
    do {
      crypto.getRandomValues(this.privateKey);
    } while (!p256.utils.isValidSecretKey(this.privateKey));
    this.opening = Object.freeze({
      protocolVersion: 2,
      sidebarInstanceId,
      drawerId,
      sourceProfile: sourceProfile === null ? null : Object.freeze({ ...sourceProfile }),
      clientPublicKey: credentialBase64(p256.getPublicKey(this.privateKey, false)),
    });
  }

  acceptOffer(raw: unknown): CredentialHandshake {
    this.assertLive();
    credentialAssert(this.offer === null, "credential-replay");
    try {
      const offer = parseCredentialOffer(raw);
      credentialAssert(
        offer.sidebarInstanceId === this.opening.sidebarInstanceId &&
          offer.drawerId === this.opening.drawerId &&
          offer.clientPublicKey === this.opening.clientPublicKey &&
          JSON.stringify(credentialSourceArray(offer.sourceProfile)) ===
            JSON.stringify(credentialSourceArray(this.opening.sourceProfile)),
        "credential-owner-mismatch",
      );
      this.offer = JSON.parse(JSON.stringify(offer)) as CredentialChannelOffer;
      const publicKey = credentialDecode(offer.helperPublicKey, 65, 65);
      const salt = credentialDecode(offer.salt, 32, 32);
      this.sendKey = deriveCredentialKey(
        this.privateKey,
        publicKey,
        salt,
        credentialKeyInfo(offer, "sidebar-to-helper"),
      );
      this.receiveKey = deriveCredentialKey(
        this.privateKey,
        publicKey,
        salt,
        credentialKeyInfo(offer, "helper-to-sidebar"),
      );
      this.privateKey.fill(0);
      this.messageCount += 1;
      return Object.freeze({
        protocolVersion: 2,
        channelId: offer.channelId,
        helperSessionId: offer.helperSessionId,
        sequence: 0,
        sealedPayload: credentialBase64(
          sealCredentialBytes(
            this.sendKey,
            credentialNonce(0),
            new Uint8Array(),
            credentialHandshakeAAD(offer, "sidebar-to-helper"),
          ),
        ),
      });
    } catch (error) {
      this.close();
      throw error;
    }
  }

  confirm(raw: unknown): void {
    this.assertLive();
    credentialAssert(this.offer && this.receiveKey && !this.ready);
    try {
      const response = parseCredentialHandshake(raw);
      credentialAssert(
        response.channelId === this.offer.channelId &&
          response.helperSessionId === this.offer.helperSessionId,
      );
      const empty = openCredentialBytes(
        this.receiveKey,
        credentialNonce(0),
        credentialDecode(response.sealedPayload, 16, 16),
        credentialHandshakeAAD(this.offer, "helper-to-sidebar"),
      );
      credentialAssert(empty.length === 0);
      this.messageCount += 1;
      this.ready = true;
      this.lastActivity = Date.now();
    } catch (error) {
      this.close();
      throw error;
    }
  }

  seal(
    value: string,
    metadata: Omit<CredentialOperationContext, "snapshotDigest">,
    snapshot: CredentialOperationSnapshot,
  ): CredentialEnvelope {
    this.assertLive();
    credentialAssert(this.ready && this.offer && this.sendKey);
    const normalized = credentialUtf8(value.trim());
    try {
      credentialAssert(normalized.length <= CREDENTIAL_LIMITS.keyBytes, "credential-too-large");
      const frozenSnapshot = parseCredentialSnapshot(JSON.parse(JSON.stringify(snapshot)));
      const bytes = credentialUtf8(JSON.stringify(frozenSnapshot));
      const context = parseCredentialContext({
        ...metadata,
        snapshotDigest: credentialSnapshotDigest(bytes),
      });
      credentialAssert(
        context.expiresAtMs > Date.now() &&
          context.expiresAtMs <= Date.now() + CREDENTIAL_LIMITS.idleMs &&
          context.purpose === snapshot.purpose &&
          context.kind === snapshot.kind &&
          JSON.stringify(credentialSourceArray(context.sourceProfile)) ===
            JSON.stringify(credentialSourceArray(this.offer.sourceProfile)) &&
          JSON.stringify(credentialSourceArray(context.sourceProfile)) ===
            JSON.stringify(credentialSourceArray(snapshot.sourceProfile)),
      );
      credentialAssert(!this.pending.has(context.requestId), "credential-replay");
      if (context.purpose === "read-edit") credentialAssert(normalized.length === 0);
      const sequence = this.nextSequence++;
      this.messageCount += 1;
      const envelope = parseCredentialEnvelope({
        protocolVersion: 2,
        channelId: this.offer.channelId,
        helperSessionId: this.offer.helperSessionId,
        sequence,
        context,
        snapshotBytes: credentialBase64(bytes),
        sealedPayload: credentialBase64(
          sealCredentialBytes(
            this.sendKey,
            credentialNonce(sequence),
            normalized,
            credentialOperationAAD(this.offer, "sidebar-to-helper", sequence, context),
          ),
        ),
      });
      const immutable = Object.freeze({
        ...envelope,
        context: Object.freeze({
          ...context,
          sourceProfile:
            context.sourceProfile === null ? null : Object.freeze({ ...context.sourceProfile }),
        }),
      });
      this.pending.set(context.requestId, immutable);
      this.lastActivity = Date.now();
      return immutable;
    } finally {
      normalized.fill(0);
    }
  }

  open(raw: unknown): string {
    this.assertLive();
    credentialAssert(this.ready && this.offer && this.receiveKey);
    const envelope = parseCredentialEnvelope(raw);
    const pending = this.pending.get(envelope.context.requestId);
    credentialAssert(
      envelope.channelId === this.offer.channelId &&
        envelope.helperSessionId === this.offer.helperSessionId &&
        pending &&
        credentialBase64(
          credentialOperationAAD(this.offer, "helper-to-sidebar", 0, envelope.context),
        ) ===
          credentialBase64(
            credentialOperationAAD(this.offer, "helper-to-sidebar", 0, pending.context),
          ) &&
        envelope.snapshotBytes === pending.snapshotBytes &&
        envelope.context.expiresAtMs > Date.now(),
      "credential-owner-mismatch",
    );
    credentialAssert(
      !this.received.has(envelope.sequence) &&
        envelope.sequence > this.highestReceived - CREDENTIAL_LIMITS.receiveWindow,
      "credential-replay",
    );
    const plaintext = openCredentialBytes(
      this.receiveKey,
      credentialNonce(envelope.sequence),
      credentialDecode(envelope.sealedPayload, CREDENTIAL_LIMITS.sealedBytes),
      credentialOperationAAD(this.offer, "helper-to-sidebar", envelope.sequence, envelope.context),
    );
    try {
      const value = credentialText(plaintext);
      this.received.add(envelope.sequence);
      this.highestReceived = Math.max(this.highestReceived, envelope.sequence);
      for (const sequence of this.received)
        if (sequence <= this.highestReceived - CREDENTIAL_LIMITS.receiveWindow)
          this.received.delete(sequence);
      this.messageCount += 1;
      this.pending.delete(envelope.context.requestId);
      this.lastActivity = Date.now();
      return value;
    } finally {
      plaintext.fill(0);
    }
  }

  get channelId(): string | null {
    return this.ready ? (this.offer?.channelId ?? null) : null;
  }

  close(): void {
    this.closed = true;
    this.ready = false;
    this.privateKey.fill(0);
    this.sendKey?.fill(0);
    this.receiveKey?.fill(0);
    this.sendKey = this.receiveKey = null;
    this.offer = null;
    this.pending.clear();
    this.received.clear();
  }

  private assertLive(): void {
    if (
      this.closed ||
      Date.now() - this.lastActivity >= CREDENTIAL_LIMITS.idleMs ||
      this.messageCount >= CREDENTIAL_LIMITS.messages ||
      this.nextSequence >= CREDENTIAL_LIMITS.messages
    ) {
      this.close();
      throw new CredentialProtocolError("credential-channel-expired");
    }
  }
}
