import type { ProviderTransport } from "./transport.js";

type Operation = "models" | "test" | "translation";
type Phase = "preparing" | "running" | "completed" | "invalidated" | "cancelled";

export interface RequestOwner<Context = unknown> {
  readonly senderId: string;
  readonly operation: Operation;
  readonly requestId: string;
  readonly context: Context;
  phase: Phase;
  assertAuthorized?: (() => void) | undefined;
  readonly jobs: Map<string, () => Promise<void> | void>;
}

export class RequestLifecycle<Context = unknown> {
  private readonly active = new Map<string, RequestOwner<Context>>();
  private readonly seen = new Map<string, Set<string>>();
  private readonly closedSenders = new Set<string>();

  begin(
    input: Omit<RequestOwner<Context>, "phase" | "jobs">,
    replace = false,
  ): RequestOwner<Context> | null {
    const scope = this.scope(input.senderId, input.operation);
    if (this.closedSenders.has(input.senderId)) return null;
    const seen = this.seen.get(scope) ?? new Set<string>();
    if (seen.has(input.requestId)) return null;
    seen.add(input.requestId);
    this.seen.set(scope, seen);
    if (replace) {
      for (const owner of this.active.values()) {
        if (owner.senderId === input.senderId && owner.operation === input.operation)
          void this.invalidate(owner);
      }
    }
    const owner: RequestOwner<Context> = { ...input, phase: "preparing", jobs: new Map() };
    this.active.set(this.key(owner), owner);
    return owner;
  }

  isActive(owner: RequestOwner<Context>): boolean {
    return (
      this.active.get(this.key(owner)) === owner &&
      (owner.phase === "preparing" || owner.phase === "running")
    );
  }

  assertActive(owner: RequestOwner<Context>, authorized: () => boolean = () => true): void {
    if (!this.isActive(owner) || !authorized())
      throw {
        category: "cancelled",
        retryable: false,
        providerCode: "REQUEST_CANCELLED",
        userAction: "NONE",
      };
    owner.assertAuthorized?.();
  }

  track(
    owner: RequestOwner<Context>,
    jobId: string,
    cancel: () => Promise<void> | void,
  ): () => void {
    this.assertActive(owner);
    owner.phase = "running";
    owner.jobs.set(jobId, cancel);
    return () => {
      if (owner.jobs.get(jobId) === cancel) owner.jobs.delete(jobId);
    };
  }

  transport(
    owner: RequestOwner<Context>,
    transport: ProviderTransport,
    authorized: () => boolean = () => true,
  ): ProviderTransport {
    return {
      request: async (request) => {
        this.assertActive(owner, authorized);
        const release = this.track(owner, request.jobId, () => transport.cancel?.(request.jobId));
        try {
          const response = await transport.request({
            ...request,
            assertActive: () => {
              this.assertActive(owner, authorized);
              request.assertActive?.();
            },
          });
          this.assertActive(owner, authorized);
          return response;
        } finally {
          release();
        }
      },
    };
  }

  async invalidate(owner: RequestOwner<Context>): Promise<void> {
    if (!this.isActive(owner)) return;
    owner.phase = "invalidated";
    this.active.delete(this.key(owner));
    const cancellations = [...owner.jobs.values()];
    owner.jobs.clear();
    owner.assertAuthorized = undefined;
    await Promise.allSettled(cancellations.map(async (cancel) => cancel()));
    owner.phase = "cancelled";
  }

  async cancel(senderId: string, operation: Operation, requestId: string): Promise<void> {
    const scope = this.scope(senderId, operation);
    if (!this.closedSenders.has(senderId)) {
      const seen = this.seen.get(scope) ?? new Set<string>();
      seen.add(requestId);
      this.seen.set(scope, seen);
    }
    const owner = this.active.get(`${scope}\u0000${requestId}`);
    if (owner) await this.invalidate(owner);
  }

  finish(owner: RequestOwner<Context>): void {
    if (this.isActive(owner)) {
      this.active.delete(this.key(owner));
      owner.phase = "completed";
    }
    owner.jobs.clear();
    owner.assertAuthorized = undefined;
  }

  async releaseSender(senderId: string): Promise<void> {
    this.closedSenders.add(senderId);
    const pending = this.cancelWhere((owner) => owner.senderId === senderId);
    for (const operation of ["models", "test", "translation"] as const)
      this.seen.delete(this.scope(senderId, operation));
    await pending;
  }

  async cancelWhere(predicate: (owner: RequestOwner<Context>) => boolean): Promise<void> {
    await Promise.allSettled(
      [...this.active.values()].filter(predicate).map((owner) => this.invalidate(owner)),
    );
  }

  owners(): RequestOwner<Context>[] {
    return [...this.active.values()];
  }

  beginRequired(input: Omit<RequestOwner<Context>, "phase" | "jobs">): RequestOwner<Context> {
    const owner = this.begin(input);
    if (!owner)
      throw {
        category: "cancelled",
        retryable: false,
        providerCode: "REQUEST_CANCELLED",
        userAction: "NONE",
      };
    return owner;
  }

  activeCount(): number {
    return this.active.size;
  }

  private scope(senderId: string, operation: Operation): string {
    return `${operation}\u0000${senderId}`;
  }

  private key(owner: Pick<RequestOwner<Context>, "senderId" | "operation" | "requestId">): string {
    return `${this.scope(owner.senderId, owner.operation)}\u0000${owner.requestId}`;
  }
}
