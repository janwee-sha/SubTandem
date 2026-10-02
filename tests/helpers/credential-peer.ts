import { p256 } from "@noble/curves/nist.js";
import {
  credentialBase64,
  credentialDecode,
  credentialHandshakeAAD,
  credentialKeyInfo,
  credentialNonce,
  credentialOperationAAD,
  credentialText,
  parseCredentialOffer,
  type CredentialEnvelope,
  type CredentialChannelOffer,
  type CredentialOwner,
} from "../../shared/credential-protocol.js";
import {
  deriveCredentialKey,
  openCredentialBytes,
  sealCredentialBytes,
} from "../../ui/credential-channel.js";

export class CredentialPeer {
  private sequence = 0;
  private readonly channels = new Map<
    string,
    { offer: CredentialChannelOffer; secret: Uint8Array }
  >();
  async call(action: string, raw: any): Promise<unknown> {
    if (action === "close") {
      for (const [id, channel] of this.channels) {
        if (
          channel.offer.senderId === raw.owner.senderId &&
          (raw.channelId === undefined || raw.channelId === id) &&
          channel.offer.drawerId === raw.owner.drawerId
        )
          this.channels.delete(id);
      }
      return { state: "closed" };
    }
    if (action === "open") {
      const secret = p256.utils.randomSecretKey();
      const offer = parseCredentialOffer({
        ...raw,
        helperSessionId: "synthetic-helper",
        channelId: `channel-${++this.sequence}`,
        helperPublicKey: credentialBase64(p256.getPublicKey(secret, false)),
        salt: credentialBase64(new Uint8Array(32).fill(7)),
      });
      this.channels.set(offer.channelId, { offer, secret });
      return offer;
    }
    if (action === "confirm") {
      const frame = raw.frame ?? raw;
      const channel = this.channels.get(frame.channelId)!;
      const { offer, secret } = channel;
      const key = (direction: "sidebar-to-helper" | "helper-to-sidebar") =>
        deriveCredentialKey(
          secret,
          credentialDecode(offer.clientPublicKey, 65),
          credentialDecode(offer.salt, 32),
          credentialKeyInfo(offer, direction),
        );
      openCredentialBytes(
        key("sidebar-to-helper"),
        credentialNonce(0),
        credentialDecode(frame.sealedPayload, 32768),
        credentialHandshakeAAD(offer, "sidebar-to-helper"),
      );
      return {
        ...frame,
        sealedPayload: credentialBase64(
          sealCredentialBytes(
            key("helper-to-sidebar"),
            credentialNonce(0),
            new Uint8Array(),
            credentialHandshakeAAD(offer, "helper-to-sidebar"),
          ),
        ),
      };
    }
    throw new Error("UNEXPECTED_CREDENTIAL_ACTION");
  }
  open(owner: CredentialOwner, frame: CredentialEnvelope): string {
    const { offer, secret } = this.channels.get(frame.channelId)!;
    if (
      owner.senderId !== offer.senderId ||
      owner.drawerId !== offer.drawerId ||
      owner.sidebarInstanceId !== offer.sidebarInstanceId
    )
      throw new Error("CREDENTIAL_OWNER_MISMATCH");
    const key = deriveCredentialKey(
      secret,
      credentialDecode(offer.clientPublicKey, 65),
      credentialDecode(offer.salt, 32),
      credentialKeyInfo(offer, "sidebar-to-helper"),
    );
    return credentialText(
      openCredentialBytes(
        key,
        credentialNonce(frame.sequence),
        credentialDecode(frame.sealedPayload, 32768),
        credentialOperationAAD(offer, "sidebar-to-helper", frame.sequence, frame.context),
      ),
    );
  }
  respond(owner: CredentialOwner, frame: CredentialEnvelope, value: string): CredentialEnvelope {
    if (this.open(owner, frame) !== "") throw new Error("NONEMPTY_READ_REQUEST");
    const { offer, secret } = this.channels.get(frame.channelId)!;
    const key = deriveCredentialKey(
      secret,
      credentialDecode(offer.clientPublicKey, 65),
      credentialDecode(offer.salt, 32),
      credentialKeyInfo(offer, "helper-to-sidebar"),
    );
    return {
      ...frame,
      sequence: 1,
      sealedPayload: credentialBase64(
        sealCredentialBytes(
          key,
          credentialNonce(1),
          new TextEncoder().encode(value),
          credentialOperationAAD(offer, "helper-to-sidebar", 1, frame.context),
        ),
      ),
    };
  }
}
