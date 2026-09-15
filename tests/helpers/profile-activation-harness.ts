import { ProfileActivationAuthority } from "../../src/providers/profile-activation.js";
import type { ProviderProfiles } from "../../src/providers/profiles.js";
import type { ProviderProfileSnapshot } from "../../src/providers/types.js";
import type { ProfileStateCommitResult } from "../../src/transport/client.js";

export interface ControlledOperation<Input, Output> {
  readonly input: Input;
  readonly promise: Promise<Output>;
}

interface PendingOperation<Input, Output> extends ControlledOperation<Input, Output> {
  resolve(value: Output): void;
  reject(error: unknown): void;
}

export class CompletionQueue<Input = unknown, Output = void> {
  private readonly operations: Array<PendingOperation<Input, Output>> = [];
  private readonly waiters: Array<{ count: number; resolve: () => void }> = [];

  get pendingCount(): number {
    return this.operations.length;
  }

  get pendingInputs(): readonly Input[] {
    return this.operations.map((operation) => operation.input);
  }

  hold(input: Input): ControlledOperation<Input, Output> {
    let resolve!: (value: Output) => void;
    let reject!: (error: unknown) => void;
    const promise = new Promise<Output>((resolvePromise, rejectPromise) => {
      resolve = resolvePromise;
      reject = rejectPromise;
    });
    const operation = { input, promise, resolve, reject };
    this.operations.push(operation);
    this.resolveWaiters();
    return operation;
  }

  async waitForPending(count = 1): Promise<void> {
    if (this.operations.length >= count) return;
    await new Promise<void>((resolve) => this.waiters.push({ count, resolve }));
  }

  releaseNext(value: Output): Input {
    const operation = this.operations.shift();
    if (!operation) throw new Error("NO_PENDING_OPERATION");
    operation.resolve(value);
    return operation.input;
  }

  rejectNext(error: unknown): Input {
    const operation = this.operations.shift();
    if (!operation) throw new Error("NO_PENDING_OPERATION");
    operation.reject(error);
    return operation.input;
  }

  private resolveWaiters(): void {
    for (let index = this.waiters.length - 1; index >= 0; index -= 1) {
      const waiter = this.waiters[index];
      if (waiter && this.operations.length >= waiter.count) {
        this.waiters.splice(index, 1);
        waiter.resolve();
      }
    }
  }
}

export class ProfileActivationHarness {
  readonly commits = new CompletionQueue();
  readonly providerBuilds = new CompletionQueue();
  readonly progress = new CompletionQueue();
  readonly finals = new CompletionQueue();
  readonly windowMessages = new CompletionQueue();
}

export function createTestProfileAuthority(
  profiles: ProviderProfiles,
  credentialConfigured: Record<string, boolean> = Object.fromEntries(
    profiles.listLatest().map((profile) => [profile.profileId, true]),
  ),
): ProfileActivationAuthority {
  let commitSequence = 0;
  let storeRevision = 0;
  return new ProfileActivationAuthority({
    authorityId: "test-authority",
    profiles,
    storeRevision,
    credentialConfigured,
    activation: null,
    createCommitId: () => `00000000-0000-4000-8000-${String(++commitSequence).padStart(12, "0")}`,
    commit: async (input): Promise<ProfileStateCommitResult> => {
      storeRevision += 1;
      return {
        state: "committed",
        initialized: true,
        storeRevision,
        lastCommit: {
          commitId: input.commitId,
          operation: "commit",
          baseRevision: input.expectedStoreRevision,
          requestDigest: "safe",
        },
        profileState: structuredClone(input.profileState),
        credentialConfigured: { ...credentialConfigured },
      };
    },
  });
}

export async function activateTestProfile(
  authority: ProfileActivationAuthority,
  profile: ProviderProfileSnapshot,
  senderId = "test-window",
): Promise<void> {
  const result = await authority.set({
    senderId,
    requestId: `activate-${senderId}-${profile.profileId}-${profile.revision}`,
    authorityId: authority.snapshot.authorityId,
    profileId: profile.profileId,
    profileRevision: profile.revision,
    endpointFingerprint: profile.endpointFingerprint,
    enabled: true,
  });
  if (result.outcome !== "changed" && result.outcome !== "unchanged")
    throw new Error("TEST_ACTIVATION_FAILED");
}

export function authorizedProviderRequest<T extends Record<string, unknown>>(
  authority: ProfileActivationAuthority,
  request: T,
): T & { authorityId: string; activationGeneration: number } {
  const snapshot = authority.snapshot;
  return {
    ...request,
    authorityId: snapshot.authorityId,
    activationGeneration: snapshot.activationGeneration,
  };
}
