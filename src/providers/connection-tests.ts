import type { ConfiguredProvider } from "./provider.js";

export interface ProviderConnectionTestTask {
  testId: string;
  playerId: string;
  requestId: string;
  profileId: string;
  profileRevision: number;
  provider: ConfiguredProvider;
}

export type ProviderConnectionTestInput = Omit<ProviderConnectionTestTask, "testId">;

export class ProviderConnectionTests {
  private readonly active = new Map<string, ProviderConnectionTestTask>();

  constructor(private readonly createId: () => string) {}

  start(input: ProviderConnectionTestInput): ProviderConnectionTestTask {
    const testId = this.createId();
    if (this.active.has(testId)) throw new Error("DUPLICATE_TEST_ID");
    const task = { testId, ...input };
    this.active.set(testId, task);
    return task;
  }

  get(testId: string): ProviderConnectionTestTask | null {
    return this.active.get(testId) ?? null;
  }

  complete(testId: string): ProviderConnectionTestTask | null {
    const task = this.active.get(testId);
    if (!task) return null;
    this.active.delete(testId);
    return task;
  }

  async cancel(testId: string): Promise<boolean> {
    const task = this.complete(testId);
    if (!task) return false;
    await task.provider.cancel?.(testId);
    return true;
  }

  async cancelProfile(profileId: string): Promise<void> {
    const tasks = [...this.active.values()].filter((task) => task.profileId === profileId);
    for (const task of tasks) this.active.delete(task.testId);
    await Promise.allSettled(tasks.map((task) => task.provider.cancel?.(task.testId)));
  }

  async cancelPlayer(playerId: string): Promise<void> {
    const tasks = [...this.active.values()].filter((task) => task.playerId === playerId);
    for (const task of tasks) this.active.delete(task.testId);
    await Promise.allSettled(tasks.map((task) => task.provider.cancel?.(task.testId)));
  }

  async cancelAll(): Promise<void> {
    const tasks = [...this.active.values()];
    this.active.clear();
    await Promise.allSettled(tasks.map((task) => task.provider.cancel?.(task.testId)));
  }

  activeCount(): number {
    return this.active.size;
  }
}
