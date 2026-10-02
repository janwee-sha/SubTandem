import { afterEach, describe, expect, it, vi } from "vitest";
import { CredentialEditor } from "../../ui/credential-editor.js";
import { CredentialPeer } from "../helpers/credential-peer.js";
import { credentialDecode, credentialText } from "../../shared/credential-protocol.js";
import { credentialSnapshotDigest } from "../../ui/credential-channel.js";

const source = { profileId: "profile-a", profileRevision: 2, endpointFingerprint: "source-a" };
const drawer = {
  drawerId: "drawer-a",
  sourceProfile: source,
  draftRevision: 4,
  keyEditEpoch: 6,
  submitEpoch: 8,
};
const snapshot = (purpose: "draft-test" | "draft-models" | "read-edit") => ({
  kind: "claude" as const,
  endpoint: "https://example.test/root",
  model: "model-雪",
  proxyMode: "direct" as const,
  purpose,
  sourceProfile: source,
  save: null,
});

function harness(read?: { value: string; delay?: Promise<void>; fail?: boolean }) {
  const peer = new CredentialPeer();
  const messages: Array<{ name: string; data: any }> = [];
  const listeners = new Map<string, (raw: unknown) => void>();
  const editor = new CredentialEditor({
    onMessage: (name, callback) => listeners.set(name, callback),
    postMessage: (name, data) => {
      messages.push({ name, data });
      const message = data as any;
      const action = name.split(":")[1]!;
      const peerInput =
        action === "open"
          ? { ...message.payload, senderId: "actual-window" }
          : {
              owner: {
                senderId: "actual-window",
                sidebarInstanceId: owner?.sidebarInstanceId,
                drawerId: drawer.drawerId,
              },
              frame: message.payload,
            };
      const response =
        action === "operation" && read
          ? (async () => {
              await read.delay;
              if (read.fail) throw new Error("synthetic-private-read-failure");
              return peer.respond(peerInput.owner, peerInput.frame, read.value);
            })()
          : peer.call(action, peerInput);
      void response.then(
        (payload) =>
          listeners.get("credential-channel:result")?.({
            requestId: message.requestId,
            ok: true,
            sidebarInstanceId: (payload as any).sidebarInstanceId ?? owner?.sidebarInstanceId,
            drawerId: drawer.drawerId,
            payload,
          }),
        () =>
          listeners.get("credential-channel:result")?.({ requestId: message.requestId, ok: false }),
      );
      if (name === "credential-channel:open") owner = message.payload;
    },
  });
  let owner: { sidebarInstanceId: string } | undefined;
  return {
    editor,
    peer,
    messages,
    revoke(drawerId = drawer.drawerId) {
      listeners.get("credential-channel:revoked")?.({
        sidebarInstanceId: owner?.sidebarInstanceId,
        drawerId,
      });
    },
  };
}

afterEach(() => vi.useRealTimers());

describe("production encrypted credential operation", () => {
  it("rebuilds a revoked channel on the next explicit operation without replaying its old frame", async () => {
    const h = harness();
    const first = await h.editor.sealOperation(
      "synthetic-first-key",
      snapshot("draft-test"),
      drawer,
      "first",
      Date.now() + 10_000,
    );
    h.revoke("wrong-drawer");
    const same = await h.editor.sealOperation(
      "synthetic-second-key",
      snapshot("draft-test"),
      drawer,
      "same-channel",
      Date.now() + 10_000,
    );
    expect(same.frame.channelId).toBe(first.frame.channelId);
    h.revoke();
    const next = await h.editor.sealOperation(
      "synthetic-third-key",
      snapshot("draft-test"),
      drawer,
      "new-channel",
      Date.now() + 10_000,
    );
    expect(next.frame.channelId).not.toBe(first.frame.channelId);
    expect(h.messages.filter((entry) => entry.name === "credential-channel:open")).toHaveLength(2);
    expect(h.messages.every((entry) => entry.name !== "provider:draft-test")).toBe(true);
    h.editor.close();
  });
  it("decrypts a read response only inside the active editor channel", async () => {
    const h = harness({ value: "synthetic-editable-original" });
    await expect(h.editor.read(snapshot("read-edit"), drawer)).resolves.toBe(
      "synthetic-editable-original",
    );
    expect(JSON.stringify(h.messages)).not.toContain("synthetic-editable-original");
    h.editor.close();
  });

  it("discards a read response after its drawer closes", async () => {
    let release!: () => void;
    const h = harness({
      value: "synthetic-late-original",
      delay: new Promise<void>((resolve) => {
        release = resolve;
      }),
    });
    const work = h.editor.read(snapshot("read-edit"), drawer);
    for (let n = 0; n < 10; n++) await Promise.resolve();
    expect(h.messages.some((entry) => entry.name === "credential-channel:operation")).toBe(true);
    h.editor.close();
    release();
    await expect(work).rejects.toThrow();
    expect(JSON.stringify(h.messages)).not.toContain("synthetic-late-original");
  });

  it.each(["synthetic-click-after-read", ""])(
    "seals current input while a previous edit read is delayed: %s",
    async (value) => {
      let release!: () => void;
      const h = harness({
        value: "synthetic-original-must-not-fallback",
        delay: new Promise<void>((resolve) => {
          release = resolve;
        }),
      });
      const reading = h.editor.read(snapshot("read-edit"), drawer);
      for (let n = 0; n < 10; n++) await Promise.resolve();
      for (const purpose of ["draft-test", "draft-models"] as const) {
        const operation = await h.editor.sealOperation(
          value,
          snapshot(purpose),
          { ...drawer, keyEditEpoch: 7, draftRevision: 5 },
          purpose,
          Date.now() + 10_000,
        );
        expect(
          h.peer.open(
            {
              senderId: "actual-window",
              sidebarInstanceId: operation.sidebarInstanceId,
              drawerId: drawer.drawerId,
            },
            operation.frame,
          ),
        ).toBe(value);
      }
      release();
      await expect(reading).resolves.toBe("synthetic-original-must-not-fallback");
      expect(JSON.stringify(h.messages)).not.toContain("synthetic-original-must-not-fallback");
      h.editor.close();
    },
  );

  it("returns only a fixed operation error on failed read", async () => {
    const h = harness({ value: "synthetic-private-original", fail: true });
    await expect(h.editor.read(snapshot("read-edit"), drawer)).rejects.toThrow(
      "CREDENTIAL_OPERATION_FAILED",
    );
    h.editor.close();
  });
  it.each(["draft-test", "draft-models"] as const)(
    "freezes %s click-time input and complete metadata",
    async (purpose) => {
      const h = harness();
      const input = snapshot(purpose);
      const deadline = Date.now() + 10_000;
      const work = h.editor.sealOperation(
        "  synthetic-click-雪-key  ",
        input,
        drawer,
        "click-request",
        deadline,
      );
      input.model = "late-model";
      input.endpoint = "https://late.test";
      const operation = await work;
      expect(operation).toMatchObject({
        drawerId: drawer.drawerId,
        frame: {
          context: {
            requestId: "click-request",
            purpose,
            draftRevision: 4,
            keyEditEpoch: 6,
            submitEpoch: 8,
            sourceProfile: source,
            expiresAtMs: deadline,
          },
        },
      });
      const frame = operation.frame;
      const decoded = credentialDecode(frame.snapshotBytes, 1048576);
      expect(frame.context.snapshotDigest).toBe(credentialSnapshotDigest(decoded));
      expect(JSON.parse(credentialText(decoded))).toEqual(snapshot(purpose));
      expect(
        h.peer.open(
          {
            senderId: "actual-window",
            sidebarInstanceId: operation.sidebarInstanceId,
            drawerId: drawer.drawerId,
          },
          frame,
        ),
      ).toBe("synthetic-click-雪-key");
      expect(JSON.stringify([...h.messages, operation])).not.toContain("synthetic-click-雪-key");
      h.editor.close();
    },
  );

  it("seals explicit empty draft input without borrowing a configured source", async () => {
    const h = harness();
    const operation = await h.editor.sealOperation(
      "",
      snapshot("draft-test"),
      drawer,
      "empty",
      Date.now() + 10_000,
    );
    expect(
      h.peer.open(
        {
          senderId: "actual-window",
          sidebarInstanceId: operation.sidebarInstanceId,
          drawerId: drawer.drawerId,
        },
        operation.frame,
      ),
    ).toBe("");
    h.editor.close();
  });

  it("rejects oversized input, nonempty read requests and mismatched drawer sources", async () => {
    const h = harness();
    await expect(
      h.editor.sealOperation(
        "雪".repeat(2731),
        snapshot("draft-test"),
        drawer,
        "large",
        Date.now() + 10_000,
      ),
    ).rejects.toThrow();
    await expect(
      h.editor.sealOperation("key", snapshot("read-edit"), drawer, "read", Date.now() + 10_000),
    ).rejects.toThrow();
    await expect(
      h.editor.sealOperation(
        "",
        { ...snapshot("draft-test"), sourceProfile: { ...source, profileRevision: 3 } },
        drawer,
        "source",
        Date.now() + 10_000,
      ),
    ).rejects.toThrow();
    h.editor.close();
  });

  it("discards an operation when its drawer closes during channel establishment", async () => {
    const h = harness();
    const work = h.editor.sealOperation(
      "synthetic-stale-key",
      snapshot("draft-test"),
      drawer,
      "stale",
      Date.now() + 10_000,
    );
    h.editor.close();
    await expect(work).rejects.toThrow();
    expect(JSON.stringify(h.messages)).not.toContain("synthetic-stale-key");
  });
});
