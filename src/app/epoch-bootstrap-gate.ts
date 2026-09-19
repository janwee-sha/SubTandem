export class EpochBootstrapGate<T> {
  private starting: Promise<T> | null = null;
  private failedEpoch: number | null = null;

  run(epoch: number, start: () => Promise<T>, failure: () => Error): Promise<T> {
    if (this.starting) return this.starting;
    if (this.failedEpoch === epoch) return Promise.reject(failure());
    const starting = start();
    this.starting = starting;
    void starting.then(
      () => {
        if (this.starting === starting) this.starting = null;
      },
      () => {
        if (this.starting !== starting) return;
        this.starting = null;
        this.failedEpoch = epoch;
      },
    );
    return starting;
  }

  reset(): void {
    this.starting = null;
    this.failedEpoch = null;
  }
}
