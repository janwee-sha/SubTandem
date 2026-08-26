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
