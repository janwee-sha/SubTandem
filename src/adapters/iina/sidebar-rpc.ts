import { parseEnvelope, SIDEBAR_MESSAGE_NAMES, type RpcEnvelope } from "../../domain/messages.js";

export interface SidebarPort {
  onMessage(name: string, callback: (data: unknown) => void): void;
  postMessage(name: string, data: unknown): void;
}

export class SidebarRpc {
  private readonly handlers = new Map<string, (message: RpcEnvelope) => void>();

  constructor(private readonly port: SidebarPort) {
    for (const name of SIDEBAR_MESSAGE_NAMES) {
      port.onMessage(name, (data) => {
        try {
          const envelope = parseEnvelope(data);
          this.handlers.get(name)?.(envelope);
        } catch {
          port.postMessage("operation:error", { code: "INVALID_MESSAGE", userAction: "NONE" });
        }
      });
    }
  }

  on(name: (typeof SIDEBAR_MESSAGE_NAMES)[number], handler: (message: RpcEnvelope) => void): void {
    this.handlers.set(name, handler);
  }

  update(view: unknown): void {
    this.port.postMessage("state:update", view);
  }
}
