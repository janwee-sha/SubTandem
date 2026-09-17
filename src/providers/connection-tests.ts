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
  private readonly activeBySender = new Map<string, ProviderConnectionTestTask>();
  private readonly seenBySender = new Map<string, Set<string>>();
  private readonly lastBySender = new Map<string, ProviderConnectionTestIdentity>();

  constructor(private readonly createId: () => string) {}

  begin(
    input: ProviderConnectionTestInput,
  ): { owner: ProviderConnectionTestTask; replaced: ProviderConnectionTestTask | null } | null {
    const seen = this.seenBySender.get(input.senderId) ?? new Set<string>();
    this.seenBySender.set(input.senderId, seen);
    if (seen.has(input.requestId)) return null;
    seen.add(input.requestId);
    const replaced = this.activeBySender.get(input.senderId) ?? null;
    if (replaced) this.activeBySender.delete(input.senderId);
    this.lastBySender.delete(input.senderId);
    const owner: ProviderConnectionTestTask = {
      testId: this.createId(),
      ...input,
      ...(input.sourceProfile ? { sourceProfile: { ...input.sourceProfile } } : {}),
      phase: "preparing",
      provider: null,
    };
    this.activeBySender.set(input.senderId, owner);
    return { owner, replaced };
  }

  isActive(owner: ProviderConnectionTestTask): boolean {
    return this.activeBySender.get(owner.senderId) === owner;
  }

  attachProvider(
    owner: ProviderConnectionTestTask,
    provider: ConfiguredProvider,
  ): ProviderConnectionTestTask | null {
    if (!this.isActive(owner) || owner.phase !== "preparing") return null;
    owner.provider = provider;
    owner.phase = "running";
    return owner;
  }

  complete(owner: ProviderConnectionTestTask): ProviderConnectionTestTask | null {
    if (!this.isActive(owner)) return null;
    this.activeBySender.delete(owner.senderId);
    this.lastBySender.set(owner.senderId, this.identity(owner));
    return owner;
  }

  async cancelTask(owner: ProviderConnectionTestTask): Promise<void> {
    await owner.provider?.cancel?.(owner.testId);
    owner.provider = null;
  }

  async cancel(senderId: string, requestId: string): Promise<boolean> {
    const active = this.activeBySender.get(senderId);
    if (active?.requestId === requestId) {
      this.activeBySender.delete(senderId);
      await this.cancelTask(active);
      return true;
    }
    const last = this.lastBySender.get(senderId);
    if (last?.requestId !== requestId) return false;
    this.lastBySender.delete(senderId);
    return true;
  }

  async releaseSender(senderId: string): Promise<void> {
    const active = this.activeBySender.get(senderId);
    this.activeBySender.delete(senderId);
    this.lastBySender.delete(senderId);
    this.seenBySender.delete(senderId);
    if (active) await this.cancelTask(active);
  }

  async invalidateProfile(
    profileId: string,
    onInvalidated?: (identities: ProviderConnectionTestIdentity[]) => void,
  ): Promise<ProviderConnectionTestIdentity[]> {
    const invalidated: ProviderConnectionTestIdentity[] = [];
    const cancellations: Promise<void>[] = [];
    for (const [senderId, active] of this.activeBySender) {
      if (active.sourceProfile?.profileId !== profileId) continue;
      this.activeBySender.delete(senderId);
      invalidated.push(this.identity(active));
      cancellations.push(this.cancelTask(active));
    }
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
    const owners = [...this.activeBySender.values()];
    this.activeBySender.clear();
    this.lastBySender.clear();
    this.seenBySender.clear();
    await Promise.allSettled(owners.map((owner) => this.cancelTask(owner)));
  }

  activeCount(): number {
    return this.activeBySender.size;
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
