import {
  credentialAssert,
  credentialRecord,
  parseCredentialOpen,
  parseCredentialHandshake,
  parseCredentialEnvelope,
} from "../../../shared/credential-protocol.js";
import {
  parseEnvelope,
  parseProfileSaveRequest,
  parseProviderDraftRequest,
  type ProviderDraftRequest,
  SIDEBAR_MESSAGE_NAMES,
  type RpcEnvelope,
} from "../../domain/messages.js";

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

export function installCredentialMainRelay(sidebar: SidebarPort, global: SidebarPort, options: { onDraftModels?(message: ProviderDraftRequest): boolean } = {}): void {
  let current: { sidebarInstanceId: string; drawerId: string } | null = null;
  const requests = new Set<string>();
  global.onMessage("credential-channel:revoked", (raw) => {
    const identity = raw as { sidebarInstanceId?: string; drawerId?: string };
    if (!current || identity?.sidebarInstanceId !== current.sidebarInstanceId || identity.drawerId !== current.drawerId) return;
    current = null;
    requests.clear();
    sidebar.postMessage("credential-channel:revoked", raw);
  });
  for (const purpose of ["draft-test", "draft-models"] as const) {
    const event = `provider:${purpose}`;
    sidebar.onMessage(event, (raw) => {
      try {
        const message = parseProviderDraftRequest(raw, purpose);
        credentialAssert(current && message.payload.sidebarInstanceId === current.sidebarInstanceId && message.payload.drawerId === current.drawerId);
        if (purpose === "draft-models" && options.onDraftModels?.(message) === false) return;
        global.postMessage(event, message);
      } catch {
        sidebar.postMessage("operation:error", { requestId: (raw as { requestId?: unknown })?.requestId, code: "INVALID_MESSAGE", userAction: "NONE" });
      }
    });
  }
  for (const name of ["open", "confirm", "operation", "close"] as const) {
    const event = `credential-channel:${name}`;
    sidebar.onMessage(event, (raw) => {
      try {
        const message = parseEnvelope(raw);
        let payload: unknown = message.payload;
        if (name === "open") {
          const record = { ...(payload as Record<string, unknown>) };
          delete record.senderId;
          const opening = parseCredentialOpen(record);
          current = { sidebarInstanceId: opening.sidebarInstanceId, drawerId: opening.drawerId };
          requests.clear();
          payload = opening;
        } else if (name === "confirm") payload = parseCredentialHandshake(payload);
        else if (name === "operation") {
          const frame = parseCredentialEnvelope(payload);
          credentialAssert(frame.context.purpose === "read-edit" && frame.context.requestId === message.requestId);
          payload = frame;
        }
        else {
          const closing = credentialRecord(payload, ["sidebarInstanceId", "drawerId"]);
          credentialAssert(
            current &&
              closing.sidebarInstanceId === current.sidebarInstanceId &&
              closing.drawerId === current.drawerId,
          );
          current = null;
          requests.clear();
        }
        if (name !== "close") {
          credentialAssert(current && requests.size < 128 && !requests.has(message.requestId));
          requests.add(message.requestId);
        }
        global.postMessage(event, { ...message, payload });
      } catch {
        sidebar.postMessage("credential-channel:result", {
          requestId: (raw as { requestId?: unknown })?.requestId,
          ok: false,
          error: "invalid-credential-message",
        });
      }
    });
  }
  for (const stage of ["prepare", "commit"] as const) {
    const event = `profile:save-${stage}`;
    sidebar.onMessage(event, (raw) => {
      try {
        const message = parseProfileSaveRequest(raw, stage);
        credentialAssert(
          current &&
            message.payload.sidebarInstanceId === current.sidebarInstanceId &&
            message.payload.drawerId === current.drawerId,
        );
        global.postMessage(event, message);
      } catch {
        sidebar.postMessage("profile:save-result", {
          requestId: (raw as { requestId?: unknown })?.requestId,
          ok: false,
        });
      }
    });
  }
  global.onMessage("profile:save-result", (raw) => {
    const response = raw as { sidebarInstanceId?: string; drawerId?: string };
    if (
      current &&
      response?.sidebarInstanceId === current.sidebarInstanceId &&
      response.drawerId === current.drawerId
    )
      sidebar.postMessage("profile:save-result", raw);
  });
  global.onMessage("credential-channel:result", (raw) => {
    if (!raw || typeof raw !== "object" || !current) return;
    const response = raw as Record<string, unknown>;
    if (typeof response.requestId !== "string" || !requests.delete(response.requestId)) return;
    if (
      response.ok === true &&
      (response.sidebarInstanceId !== current.sidebarInstanceId ||
        response.drawerId !== current.drawerId)
    )
      return;
    sidebar.postMessage("credential-channel:result", raw);
  });
}
