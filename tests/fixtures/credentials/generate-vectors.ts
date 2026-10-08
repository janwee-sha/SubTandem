import { createECDH, hkdfSync, createCipheriv, createHash } from "node:crypto";
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  credentialBase64,
  credentialUtf8,
  credentialNonce,
  credentialKeyInfo,
  credentialHandshakeAAD,
  credentialOperationAAD,
} from "../../../shared/credential-protocol.ts";
import type {
  CredentialChannelOffer,
  CredentialOperationContext,
} from "../../../shared/credential-protocol.ts";

const b64 = credentialBase64;
const clientPrivateKey = Uint8Array.from({ length: 32 }, (_, index) => index + 1);
const helperPrivateKey = Uint8Array.from({ length: 32 }, (_, index) => 100 + index);
const client = createECDH("prime256v1");
const helper = createECDH("prime256v1");
client.setPrivateKey(clientPrivateKey);
helper.setPrivateKey(helperPrivateKey);
const salt = Uint8Array.from({ length: 32 }, (_, index) => 200 + index);
const offer: CredentialChannelOffer = {
  protocolVersion: 2,
  sidebarInstanceId: "sidebar-vector",
  senderId: "window-vector",
  drawerId: "drawer-vector",
  helperSessionId: "helper-vector",
  channelId: "channel-vector",
  sourceProfile: {
    profileId: "00000000-0000-4000-8000-000000000001",
    profileRevision: 7,
    endpointFingerprint: "endpoint-vector",
  },
  clientPublicKey: b64(client.getPublicKey()),
  helperPublicKey: b64(helper.getPublicKey()),
  salt: b64(salt),
};
const snapshot = credentialUtf8(
  JSON.stringify({
    kind: "openai",
    endpoint: "https://example.test",
    model: 'model/雪\\"\n😀',
    proxyMode: "direct",
    purpose: "draft-test",
    sourceProfile: offer.sourceProfile,
    save: null,
  }),
);
const context: CredentialOperationContext = {
  requestId: "request-vector",
  draftRevision: 3,
  keyEditEpoch: 1,
  submitEpoch: 0,
  purpose: "draft-test",
  sourceProfile: offer.sourceProfile,
  kind: "openai",
  endpointFingerprint: "endpoint-vector",
  snapshotDigest: createHash("sha256").update(snapshot).digest("hex"),
  expiresAtMs: 1900000000000,
};
const shared = client.computeSecret(helper.getPublicKey());
const vectors = ["sidebar-to-helper", "helper-to-sidebar"].map((direction) => {
  const d = direction as "sidebar-to-helper" | "helper-to-sidebar";
  const info = credentialKeyInfo(offer, d);
  const key = Buffer.from(hkdfSync("sha256", shared, salt, info, 32));
  const encrypt = (plaintext: Uint8Array, sequence: number, aad: Uint8Array) => {
    const cipher = createCipheriv("aes-256-gcm", key, credentialNonce(sequence));
    cipher.setAAD(aad);
    return b64(Buffer.concat([cipher.update(plaintext), cipher.final(), cipher.getAuthTag()]));
  };
  const value = credentialUtf8('synthetic-雪/\\"\n😀-only');
  return {
    direction,
    key: b64(key),
    info: b64(info),
    nonce: b64(credentialNonce(1)),
    handshakeAAD: b64(credentialHandshakeAAD(offer, d)),
    handshakeSealed: encrypt(new Uint8Array(), 0, credentialHandshakeAAD(offer, d)),
    aad: b64(credentialOperationAAD(offer, d, 1, context)),
    plaintext: b64(value),
    sealed: encrypt(value, 1, credentialOperationAAD(offer, d, 1, context)),
  };
});
writeFileSync(
  fileURLToPath(new URL("./channel-vectors.json", import.meta.url)),
  `${JSON.stringify({ clientPrivateKey: b64(clientPrivateKey), helperPrivateKey: b64(helperPrivateKey), shared: b64(shared), offer, snapshotBytes: b64(snapshot), context, vectors }, null, 2)}\n`,
);
