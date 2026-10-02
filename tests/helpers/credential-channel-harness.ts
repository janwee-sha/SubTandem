import { CredentialChannelRelay } from "../../src/adapters/iina/global-rpc.js";
import { installCredentialMainRelay } from "../../src/adapters/iina/sidebar-rpc.js";
import { CompletionQueue } from "./profile-activation-harness.js";

export function credentialRelayHarness() {
  const calls = new CompletionQueue<{ action: string; payload: any }, unknown>();
  const authorizations = new CompletionQueue<unknown, void>();
  const replies: Array<{ senderId: string; name: string; data: any }> = [];
  const relay = new CredentialChannelRelay({
    send: (senderId, name, data) => replies.push({ senderId, name, data }),
    call: (action, payload) => calls.hold({ action, payload }).promise,
    authorizeSource: (source) => authorizations.hold(source).promise,
  });
  const sidebarHandlers = new Map<string, (data: unknown) => void>();
  const globalHandlers = new Map<string, (data: unknown) => void>();
  const forwarded: Array<{ name: string; data: any }> = [];
  const sidebarReplies: Array<{ name: string; data: unknown }> = [];
  installCredentialMainRelay(
    {
      onMessage: (name, callback) => sidebarHandlers.set(name, callback),
      postMessage: (name, data) => sidebarReplies.push({ name, data }),
    },
    {
      onMessage: (name, callback) => globalHandlers.set(name, callback),
      postMessage: (name, data) => forwarded.push({ name, data }),
    },
  );
  return {
    relay,
    calls,
    authorizations,
    replies,
    sidebarHandlers,
    globalHandlers,
    forwarded,
    sidebarReplies,
  };
}
