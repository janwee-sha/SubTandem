import { SidebarCredentialChannel, credentialRandomId } from "./credential-channel.js";
import { credentialAssert, parseCredentialSnapshot } from "../shared/credential-protocol.js";
import type {
  CredentialOperationSnapshot,
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
    if (this.current?.drawerId === drawerId) return this.current.ready;
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
    })();
    return current.ready;
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
        JSON.stringify(reservation.sourceProfile) === JSON.stringify(drawer.sourceProfile) &&
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
