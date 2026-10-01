import {
  credentialAssert,
  credentialSourceArray,
  credentialIdentity,
  credentialRecord,
  parseCredentialOpen,
  parseCredentialOffer,
  parseCredentialHandshake,
  parseCredentialEnvelope,
} from "../../../shared/credential-protocol.js";
import type {
  CredentialChannelOpen,
  CredentialChannelOffer,
  CredentialOwner,
  CredentialEnvelope,
} from "../../../shared/credential-protocol.js";
import { parseEnvelope, type RpcEnvelope } from "../../domain/messages.js";

type Handler = (message: RpcEnvelope, context: { playerId: string }) => Promise<unknown> | unknown;
type PostMessage = (playerId: string, name: string, data: unknown) => void;

export class GlobalRpcRouter {
  private readonly handlers = new Map<string, Handler>();
  private readonly active = new Set<string>();
  private readonly revisions = new Map<string, number>();

  constructor(private readonly postMessage: PostMessage) {}

  register(name: string, handler: Handler): void {
    this.handlers.set(name, handler);
  }

  async receive(playerId: string, name: string, raw: unknown): Promise<void> {
    let message: RpcEnvelope;
    try {
      message = parseEnvelope(raw);
    } catch {
      this.postMessage(playerId, `${name}:error`, { error: { code: "INVALID_MESSAGE" } });
      return;
    }
    const key = `${playerId}\u0000${message.requestId}`;
    const currentRevision = this.revisions.get(playerId) ?? 0;
    if (message.revision < currentRevision) {
      this.postMessage(playerId, `${name}:error`, { error: { code: "STALE_REVISION" } });
      return;
    }
    if (this.active.has(key)) {
      this.postMessage(playerId, `${name}:error`, { error: { code: "DUPLICATE_REQUEST" } });
      return;
    }
    const handler = this.handlers.get(name);
    if (!handler) {
      this.postMessage(playerId, `${name}:error`, { error: { code: "UNKNOWN_MESSAGE" } });
      return;
    }
    this.revisions.set(playerId, message.revision);
    this.active.add(key);
    try {
      const data = await handler(message, { playerId });
      this.postMessage(playerId, `${name}:result`, data);
    } catch {
      this.postMessage(playerId, `${name}:error`, { error: { code: "OPERATION_FAILED" } });
    } finally {
      this.active.delete(key);
    }
  }
}

export interface CredentialRelayOptions {
  send(senderId: string, name: string, data: unknown): void;
  call(action: string, payload: unknown): Promise<unknown>;
  authorizeSource(source: unknown): Promise<void>;
  onClose?(owner: CredentialOwner): void;
}
export class CredentialChannelRelay {
  private readonly closings = new Map<string, Promise<unknown>>();
  private readonly owners = new Map<
    string,
    { opening: CredentialChannelOpen; offer?: CredentialChannelOffer; confirmed: boolean }
  >();
  constructor(private readonly options: CredentialRelayOptions) {}
  async receive(senderId: string, name: string, raw: unknown): Promise<void> {
    let requestId = "";
    let owner = this.owners.get(senderId);
    try {
      credentialAssert(credentialIdentity(senderId));
      const message = parseEnvelope(raw);
      requestId = message.requestId;
      if (name === "credential-channel:open") {
        const opening = parseCredentialOpen(message.payload);
        this.close(senderId);
        owner = { opening: JSON.parse(JSON.stringify(opening)), confirmed: false };
        this.owners.set(senderId, owner);
        await this.options.authorizeSource(opening.sourceProfile);
        if (this.owners.get(senderId) !== owner) return;
        const closing = this.closings.get(senderId);
        if (closing) await closing;
        if (this.owners.get(senderId) !== owner) return;
        const rawOffer = await this.options.call("open", { ...opening, senderId });
        if (this.owners.get(senderId) !== owner) return;
        const offer = parseCredentialOffer(rawOffer);
        credentialAssert(
          offer.senderId === senderId &&
            offer.sidebarInstanceId === opening.sidebarInstanceId &&
            offer.drawerId === opening.drawerId &&
            offer.clientPublicKey === opening.clientPublicKey &&
            JSON.stringify(credentialSourceArray(offer.sourceProfile)) ===
              JSON.stringify(credentialSourceArray(opening.sourceProfile)),
        );
        owner.offer = offer;
        this.reply(senderId, requestId, offer, owner.opening);
        return;
      }
      credentialAssert(owner && owner.offer);
      if (name === "credential-channel:close") {
        const closing = credentialRecord(message.payload, ["sidebarInstanceId", "drawerId"]);
        credentialAssert(
          closing.sidebarInstanceId === owner.opening.sidebarInstanceId &&
            closing.drawerId === owner.opening.drawerId,
        );
        this.close(senderId);
        return;
      }
      const frame =
        name === "credential-channel:confirm"
          ? parseCredentialHandshake(message.payload)
          : parseCredentialEnvelope(message.payload);
      credentialAssert(
        frame.channelId === owner.offer.channelId &&
          frame.helperSessionId === owner.offer.helperSessionId,
      );
      credentialAssert(
        name === "credential-channel:confirm"
          ? !owner.confirmed
          : name === "credential-channel:operation" && owner.confirmed,
      );
      if ("context" in frame)
        credentialAssert(
          frame.context.purpose === "read-edit" && frame.context.requestId === requestId,
        );
      const identity = {
        senderId,
        sidebarInstanceId: owner.opening.sidebarInstanceId,
        drawerId: owner.opening.drawerId,
      };
      const response = await this.options.call(
        name === "credential-channel:confirm" ? "confirm" : "operation",
        { owner: identity, frame },
      );
      if (this.owners.get(senderId) !== owner) return;
      const parsed =
        name === "credential-channel:confirm"
          ? parseCredentialHandshake(response)
          : parseCredentialEnvelope(response);
      credentialAssert(
        parsed.channelId === owner.offer.channelId &&
          parsed.helperSessionId === owner.offer.helperSessionId,
      );
      if (name === "credential-channel:confirm") owner.confirmed = true;
      this.reply(senderId, requestId, parsed, owner.opening);
    } catch {
      if (owner && this.owners.get(senderId) !== owner) return;
      if (name === "credential-channel:open" || name === "credential-channel:confirm")
        this.close(senderId);
      this.options.send(senderId, "credential-channel:result", {
        requestId,
        ok: false,
        error: "credential-channel-unavailable",
      });
    }
  }
  ownerFor(
    senderId: string,
    identity: { sidebarInstanceId: string; drawerId: string },
    frame?: CredentialEnvelope,
  ): CredentialOwner {
    const owner = this.owners.get(senderId);
    credentialAssert(
      owner?.confirmed &&
        owner.offer &&
        owner.opening.sidebarInstanceId === identity.sidebarInstanceId &&
        owner.opening.drawerId === identity.drawerId,
    );
    if (frame)
      credentialAssert(
        frame.channelId === owner.offer.channelId &&
          frame.helperSessionId === owner.offer.helperSessionId,
      );
    return {
      senderId,
      sidebarInstanceId: owner.opening.sidebarInstanceId,
      drawerId: owner.opening.drawerId,
    };
  }
  closeProfile(profileId: string): void {
    for (const [senderId, owner] of this.owners)
      if (owner.opening.sourceProfile?.profileId === profileId) this.close(senderId);
  }
  close(senderId: string): void {
    const owner = this.owners.get(senderId);
    this.owners.delete(senderId);
    if (owner)
      this.options.onClose?.({
        senderId,
        sidebarInstanceId: owner.opening.sidebarInstanceId,
        drawerId: owner.opening.drawerId,
      });
    if (owner) {
      const closing = this.options
        .call("close", {
          ...(owner.offer ? { channelId: owner.offer.channelId } : {}),
          owner: {
            senderId,
            sidebarInstanceId: owner.opening.sidebarInstanceId,
            drawerId: owner.opening.drawerId,
          },
        })
        .catch(() => undefined);
      this.closings.set(senderId, closing);
      void closing.finally(() => {
        if (this.closings.get(senderId) === closing) this.closings.delete(senderId);
      });
    }
  }
  private reply(
    senderId: string,
    requestId: string,
    payload: unknown,
    opening: CredentialChannelOpen,
  ): void {
    this.options.send(senderId, "credential-channel:result", {
      requestId,
      ok: true,
      sidebarInstanceId: opening.sidebarInstanceId,
      drawerId: opening.drawerId,
      payload,
    });
  }
}
