import { SidebarCredentialChannel, credentialRandomId } from "./credential-channel.js";
import { identityHash } from "../src/domain/identity.js";
import {
  credentialAssert,
  credentialSourceArray,
  credentialUtf8,
  parseCredentialSnapshot,
} from "../shared/credential-protocol.js";
import type {
  CredentialOperationSnapshot,
  CredentialEnvelope,
  CredentialSnapshotProfile,
  CredentialSnapshotState,
  CredentialSourceProfile,
} from "../shared/credential-protocol.js";

interface EditorPort {
  postMessage(name: string, data: unknown): void;
  onMessage(name: string, callback: (data: unknown) => void): void;
}
interface EditorSaveInput {
  profileId?: string;
  expectedRevision?: number;
  displayName: string;
  kind: CredentialSnapshotProfile["kind"];
  endpoint: string;
  model: string;
  proxyMode: "system" | "direct";
}
interface EditorReservation {
  reservationId: string;
  requestId: string;
  expiresAtMs: number;
  commitId: string;
  expectedStoreRevision: number;
  expectedProfileRevision: number | null;
  profile: CredentialSnapshotProfile;
  profileState: CredentialSnapshotState;
  sourceProfile: CredentialSourceProfile | null;
}
interface EditorDrawer {
  drawerId: string;
  sourceProfile: CredentialSourceProfile | null;
  draftRevision: number;
  keyEditEpoch: number;
  submitEpoch: number;
}

export class CredentialEditor {
  private readonly sidebarInstanceId = credentialRandomId();
  private current: {
    drawerId: string;
    channel: SidebarCredentialChannel;
    ready: Promise<void>;
  } | null = null;
  private readonly pending = new Map<
    string,
    {
      resolve(value: unknown): void;
      reject(): void;
      timer: ReturnType<typeof setTimeout>;
      event: string;
    }
  >();

  constructor(
    private readonly port: EditorPort,
    private readonly timers: Pick<typeof globalThis, "setTimeout" | "clearTimeout"> = globalThis,
  ) {
    port.onMessage("credential-channel:revoked", (raw) => {
      const identity = raw as { sidebarInstanceId?: string; drawerId?: string };
      if (
        identity?.sidebarInstanceId === this.sidebarInstanceId &&
        identity.drawerId === this.current?.drawerId
      )
        this.close();
    });
    for (const event of ["credential-channel:result", "profile:save-result"]) {
      port.onMessage(event, (raw) => {
        const response = raw as {
          requestId?: string;
          ok?: boolean;
          payload?: unknown;
          sidebarInstanceId?: string;
          drawerId?: string;
        };
        const pending = this.pending.get(response?.requestId ?? "");
        if (!pending || pending.event !== event) return;
        if (
          response.ok &&
          (response.sidebarInstanceId !== this.sidebarInstanceId ||
            response.drawerId !== this.current?.drawerId)
        )
          return;
        this.pending.delete(response.requestId!);
        this.timers.clearTimeout(pending.timer);
        if (response.ok) pending.resolve(response.payload);
        else pending.reject();
      });
    }
  }

  private send(name: string, payload: unknown, requestId = credentialRandomId()): Promise<unknown> {
    credentialAssert(!this.pending.has(requestId));
    return new Promise((resolve, reject) => {
      const fail = () => reject(new Error("CREDENTIAL_OPERATION_FAILED"));
      const timer = this.timers.setTimeout(() => {
        this.pending.delete(requestId);
        fail();
      }, 15_000);
      this.pending.set(requestId, {
        resolve,
        reject: fail,
        timer,
        event: name.startsWith("profile:") ? "profile:save-result" : "credential-channel:result",
      });
      this.port.postMessage(name, { requestId, revision: 1, payload });
    });
  }

  open(drawerId: string, sourceProfile: CredentialSourceProfile | null): Promise<void> {
    if (this.current?.drawerId === drawerId && !this.current.channel.expired)
      return this.current.ready;
    this.close();
    const channel = new SidebarCredentialChannel(this.sidebarInstanceId, drawerId, sourceProfile);
    const current = { drawerId, channel, ready: Promise.resolve() };
    this.current = current;
    current.ready = (async () => {
      const offer = await this.send("credential-channel:open", channel.opening);
      credentialAssert(this.current === current);
      const confirmation = channel.acceptOffer(offer);
      const acknowledged = await this.send("credential-channel:confirm", confirmation);
      credentialAssert(this.current === current);
      channel.confirm(acknowledged);
    })().catch((error: unknown) => {
      if (this.current === current) this.close();
      throw error;
    });
    return current.ready;
  }

  async sealOperation(
    value: string,
    input: CredentialOperationSnapshot,
    drawer: EditorDrawer,
    requestId: string,
    expiresAtMs: number,
  ): Promise<{ sidebarInstanceId: string; drawerId: string; frame: CredentialEnvelope }> {
    const snapshot = parseCredentialSnapshot(JSON.parse(JSON.stringify(input)));
    const frozen = JSON.parse(JSON.stringify(drawer)) as EditorDrawer;
    const bytes = credentialUtf8(value.trim());
    const validSize = bytes.length <= 8_192;
    bytes.fill(0);
    credentialAssert(validSize, "credential-too-large");
    credentialAssert(
      ["read-edit", "draft-test", "draft-models"].includes(snapshot.purpose) &&
        (snapshot.purpose !== "read-edit" || value === "") &&
        expiresAtMs > Date.now() &&
        expiresAtMs <= Date.now() + 30_000 &&
        JSON.stringify(credentialSourceArray(snapshot.sourceProfile)) ===
          JSON.stringify(credentialSourceArray(frozen.sourceProfile)),
    );
    const ready = this.open(frozen.drawerId, frozen.sourceProfile);
    const current = this.current!;
    try {
      await ready;
      credentialAssert(this.current === current);
      const frame = current.channel.seal(
        value,
        {
          requestId,
          draftRevision: frozen.draftRevision,
          keyEditEpoch: frozen.keyEditEpoch,
          submitEpoch: frozen.submitEpoch,
          purpose: snapshot.purpose,
          sourceProfile: snapshot.sourceProfile,
          kind: snapshot.kind,
          endpointFingerprint: identityHash({
            kind: snapshot.kind,
            endpoint: snapshot.endpoint,
            proxyMode: snapshot.proxyMode,
          }),
          expiresAtMs,
        },
        snapshot,
      );
      return { sidebarInstanceId: this.sidebarInstanceId, drawerId: frozen.drawerId, frame };
    } finally {
      value = "";
    }
  }

  async read(input: CredentialOperationSnapshot, drawer: EditorDrawer): Promise<string> {
    const operation = await this.sealOperation(
      "",
      input,
      drawer,
      credentialRandomId(),
      Date.now() + 15_000,
    );
    const current = this.current!;
    const response = await this.send(
      "credential-channel:operation",
      operation.frame,
      operation.frame.context.requestId,
    );
    credentialAssert(this.current === current);
    return current.channel.open(response);
  }

  async save(
    value: string,
    input: EditorSaveInput,
    drawer: {
      drawerId: string;
      sourceProfile: CredentialSourceProfile | null;
      draftRevision: number;
      keyEditEpoch: number;
      submitEpoch: number;
    },
    requestId: string,
  ): Promise<{
    profile: CredentialSnapshotProfile & { credentialConfigured: boolean };
    selectionInvalidated: boolean;
  }> {
    const frozen = JSON.parse(JSON.stringify(input)) as EditorSaveInput;
    const ready = this.open(drawer.drawerId, drawer.sourceProfile);
    const current = this.current!;
    await ready;
    credentialAssert(this.current === current);
    const owner = { sidebarInstanceId: this.sidebarInstanceId, drawerId: drawer.drawerId };
    const reservation = (await this.send(
      "profile:save-prepare",
      { ...owner, input: frozen },
      requestId,
    )) as EditorReservation;
    credentialAssert(
      this.current === current &&
        reservation.requestId === requestId &&
        reservation.expiresAtMs > Date.now(),
    );
    const profile = reservation.profile;
    const snapshot: CredentialOperationSnapshot = parseCredentialSnapshot({
      kind: profile.kind,
      endpoint: profile.endpoint,
      model: profile.model ?? null,
      proxyMode: profile.proxyMode,
      purpose: "save-profile",
      sourceProfile: reservation.sourceProfile,
      save: {
        commitId: reservation.commitId,
        expectedStoreRevision: reservation.expectedStoreRevision,
        expectedProfileRevision: reservation.expectedProfileRevision,
        profileState: reservation.profileState,
      },
    });
    credentialAssert(
      profile.kind === frozen.kind &&
        profile.endpoint === frozen.endpoint &&
        profile.model === frozen.model &&
        profile.proxyMode === frozen.proxyMode &&
        JSON.stringify(credentialSourceArray(reservation.sourceProfile)) ===
          JSON.stringify(credentialSourceArray(drawer.sourceProfile)) &&
        (frozen.profileId === undefined || profile.profileId === frozen.profileId) &&
        profile.revision === (frozen.expectedRevision ?? 0) + 1,
    );
    const frame = current.channel.seal(
      value,
      {
        requestId,
        draftRevision: drawer.draftRevision,
        keyEditEpoch: drawer.keyEditEpoch,
        submitEpoch: drawer.submitEpoch,
        purpose: "save-profile",
        sourceProfile: reservation.sourceProfile,
        kind: profile.kind,
        endpointFingerprint: profile.endpointFingerprint,
        expiresAtMs: reservation.expiresAtMs,
      },
      snapshot,
    );
    value = "";
    const response = await this.send(
      "profile:save-commit",
      { ...owner, reservationId: reservation.reservationId, frame },
      requestId,
    );
    credentialAssert(this.current === current);
    return response as {
      profile: CredentialSnapshotProfile & { credentialConfigured: boolean };
      selectionInvalidated: boolean;
    };
  }

  get channelId(): string | null {
    return this.current?.channel.channelId ?? null;
  }

  close(): void {
    const current = this.current;
    this.current = null;
    current?.channel.close();
    for (const request of this.pending.values()) {
      this.timers.clearTimeout(request.timer);
      request.reject();
    }
    this.pending.clear();
    if (current)
      this.port.postMessage("credential-channel:close", {
        requestId: credentialRandomId(),
        revision: 1,
        payload: { sidebarInstanceId: this.sidebarInstanceId, drawerId: current.drawerId },
      });
  }
}

declare global {
  interface Window {
    subtandemCredentialEditor: { create(port: EditorPort): CredentialEditor };
  }
}
if (typeof window !== "undefined")
  window.subtandemCredentialEditor = { create: (port) => new CredentialEditor(port) };
