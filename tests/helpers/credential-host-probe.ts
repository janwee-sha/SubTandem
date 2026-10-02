import { SidebarCredentialChannel, credentialRandomId } from "../../ui/credential-channel.js";
import fixture from "../fixtures/credentials/host-probe.json";
import type { CredentialOperationSnapshot } from "../../shared/credential-protocol.js";

const port = window.iina;
const panel = document.createElement("section");
panel.id = "credential-host-probe";
const title = document.createElement("h3");
title.textContent = "Credential feasibility probe — test build";
const status = document.createElement("p");
status.textContent = "Synthetic data only. Run in an isolated IINA test user.";
panel.append(title, status);
document.body.prepend(panel);
const pending = new Map<string, { resolve(value: unknown): void; reject(): void; timer: number }>();
port?.onMessage("credential-channel:result", (raw: unknown) => {
  const response = raw as { requestId?: string; ok?: boolean; payload?: unknown };
  const request = pending.get(response.requestId ?? "");
  if (!request) return;
  pending.delete(response.requestId!);
  window.clearTimeout(request.timer);
  if (response.ok) request.resolve(response.payload);
  else request.reject();
});
function send(name: string, payload: unknown): Promise<unknown> {
  const requestId = credentialRandomId();
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => {
      pending.delete(requestId);
      reject(new Error("PROBE_TIMEOUT"));
    }, 15000);
    pending.set(requestId, { resolve, reject: () => reject(new Error("PROBE_FAILED")), timer });
    port?.postMessage(name, { requestId, revision: 1, payload });
  });
}
let active: SidebarCredentialChannel | null = null;
let owner: { sidebarInstanceId: string; drawerId: string } | null = null;
function close(): void {
  active?.close();
  active = null;
  if (owner)
    port?.postMessage("credential-channel:close", {
      requestId: credentialRandomId(),
      revision: 1,
      payload: owner,
    });
  owner = null;
}
let busy = false;
for (const [action, label] of [
  ["create", "Create protected sample"],
  ["recover", "Recover sample"],
  ["replace", "Replace sample"],
  ["remove", "Remove sample"],
]) {
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = label!;
  button.addEventListener("click", async () => {
    if (busy) return;
    busy = true;
    status.textContent = `${label}: running`;
    try {
      close();
      owner = { sidebarInstanceId: credentialRandomId(), drawerId: credentialRandomId() };
      const channel = new SidebarCredentialChannel(owner.sidebarInstanceId, owner.drawerId, null);
      active = channel;
      const offer = await send("credential-channel:open", channel.opening);
      const confirmation = channel.acceptOffer(offer);
      channel.confirm(await send("credential-channel:confirm", confirmation));
      const snapshot: CredentialOperationSnapshot = {
        kind: "openai",
        endpoint: fixture.endpoint,
        model: action!,
        proxyMode: "direct",
        purpose: "draft-test",
        sourceProfile: null,
        save: null,
      };
      const frame = channel.seal(
        fixture.syntheticValue,
        {
          requestId: credentialRandomId(),
          draftRevision: 1,
          keyEditEpoch: 1,
          submitEpoch: 0,
          purpose: "draft-test",
          sourceProfile: null,
          kind: "openai",
          endpointFingerprint: fixture.endpointFingerprint,
          expiresAtMs: Date.now() + 30000,
        },
        snapshot,
      );
      const response = await send("credential-channel:operation", frame);
      const value = channel.open(response);
      if (value !== (action === "remove" ? "" : fixture.syntheticValue))
        throw new Error("PROBE_MISMATCH");
      status.textContent = `${label}: PASS`;
    } catch {
      status.textContent = `${label}: FAIL (no fallback)`;
    } finally {
      close();
      busy = false;
    }
  });
  panel.append(button);
}
window.addEventListener("pagehide", () => {
  close();
  for (const request of pending.values()) {
    window.clearTimeout(request.timer);
    request.reject();
  }
  pending.clear();
});
