import { RequestLifecycle, type RequestOwner } from "./request-lifecycle.js";
import type { ConfiguredProvider } from "./provider.js";

export interface ProviderConnectionTestSourceProfile {
  profileId: string;
  profileRevision: number;
  endpointFingerprint: string;
}

export interface ProviderConnectionTestIdentity {
  testId: string;
  senderId: string;
  requestId: string;
  drawerId: string;
  draftRevision: number;
  sourceProfile?: ProviderConnectionTestSourceProfile;
  credentialEpoch: number;
}

export interface ProviderConnectionTestTask extends ProviderConnectionTestIdentity {
  phase: "preparing" | "running";
  provider: ConfiguredProvider | null;
}

export type ProviderConnectionTestInput = Omit<ProviderConnectionTestIdentity, "testId">;

export class ProviderConnectionTests {
  private readonly requests = new RequestLifecycle<ProviderConnectionTestIdentity>();
  private readonly scopes = new WeakMap<
    ProviderConnectionTestTask,
    RequestOwner<ProviderConnectionTestIdentity>
  >();
  private readonly tasks = new WeakMap<
    RequestOwner<ProviderConnectionTestIdentity>,
    ProviderConnectionTestTask
  >();
  private readonly lastBySender = new Map<string, ProviderConnectionTestIdentity>();

  constructor(private readonly createId: () => string) {}

  begin(
    input: ProviderConnectionTestInput,
  ): { owner: ProviderConnectionTestTask; replaced: ProviderConnectionTestTask | null } | null {
    const previous = this.requests.owners().find((owner) => owner.senderId === input.senderId);
    const identity = this.identity({ ...input, testId: "" });
    const scope = this.requests.begin(
      {
        senderId: input.senderId,
        operation: "test",
        requestId: input.requestId,
        context: identity,
      },
      true,
    );
    if (!scope) return null;
    identity.testId = this.createId();
    this.lastBySender.delete(input.senderId);
    const owner: ProviderConnectionTestTask = { ...identity, phase: "preparing", provider: null };
    this.scopes.set(owner, scope);
    this.tasks.set(scope, owner);
    return { owner, replaced: previous ? (this.tasks.get(previous) ?? null) : null };
  }

  isActive(owner: ProviderConnectionTestTask): boolean {
    const scope = this.scopes.get(owner);
    return Boolean(scope && this.requests.isActive(scope));
  }

  attachProvider(
    owner: ProviderConnectionTestTask,
    provider: ConfiguredProvider,
  ): ProviderConnectionTestTask | null {
    if (!this.isActive(owner) || owner.phase !== "preparing") return null;
    owner.provider = provider;
    owner.phase = "running";
    this.requests.track(this.scopes.get(owner)!, owner.testId, () => {
      owner.provider = null;
      return provider.cancel?.(owner.testId);
    });
    return owner;
  }

  complete(owner: ProviderConnectionTestTask): ProviderConnectionTestTask | null {
    if (!this.isActive(owner)) return null;
    this.requests.finish(this.scopes.get(owner)!);
    owner.provider = null;
    this.lastBySender.set(owner.senderId, this.identity(owner));
    return owner;
  }

  async cancelTask(owner: ProviderConnectionTestTask): Promise<void> {
    const scope = this.scopes.get(owner);
    if (scope) await this.requests.invalidate(scope);
    owner.provider = null;
  }

  async cancel(senderId: string, requestId: string): Promise<boolean> {
    const active = this.requests
      .owners()
      .some((owner) => owner.senderId === senderId && owner.requestId === requestId);
    const last = this.lastBySender.get(senderId)?.requestId === requestId;
    if (last) this.lastBySender.delete(senderId);
    await this.requests.cancel(senderId, "test", requestId);
    return active || last;
  }

  async releaseSender(senderId: string): Promise<void> {
    this.lastBySender.delete(senderId);
    await this.requests.releaseSender(senderId);
  }

  async invalidateProfile(
    profileId: string,
    onInvalidated?: (identities: ProviderConnectionTestIdentity[]) => void,
  ): Promise<ProviderConnectionTestIdentity[]> {
    const active = this.requests
      .owners()
      .filter((owner) => owner.context.sourceProfile?.profileId === profileId);
    const invalidated = active.map((owner) => this.identity(owner.context));
    const cancellations = active.map((owner) => this.requests.invalidate(owner));
    for (const [senderId, last] of this.lastBySender) {
      if (last.sourceProfile?.profileId !== profileId) continue;
      this.lastBySender.delete(senderId);
      invalidated.push(this.identity(last));
    }
    onInvalidated?.(invalidated.map((identity) => this.identity(identity)));
    await Promise.allSettled(cancellations);
    return invalidated;
  }

  async cancelAll(): Promise<void> {
    this.lastBySender.clear();
    await this.requests.cancelWhere(() => true);
  }

  activeCount(): number {
    return this.requests.activeCount();
  }

  private identity(owner: ProviderConnectionTestIdentity): ProviderConnectionTestIdentity {
    return {
      testId: owner.testId,
      senderId: owner.senderId,
      requestId: owner.requestId,
      drawerId: owner.drawerId,
      draftRevision: owner.draftRevision,
      ...(owner.sourceProfile ? { sourceProfile: { ...owner.sourceProfile } } : {}),
      credentialEpoch: owner.credentialEpoch,
    };
  }
}
