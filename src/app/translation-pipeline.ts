export class TranslationPipeline {
  private active: Promise<void> | null = null;

  run(work: () => Promise<void>): boolean {
    if (this.active) return false;
    this.active = work().finally(() => {
      this.active = null;
    });
    return true;
  }

  whenIdle(): Promise<void> {
    return this.active ?? Promise.resolve();
  }
  get inFlight(): boolean {
    return this.active !== null;
  }
}
