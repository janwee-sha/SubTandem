export class FakeClock {
  private nowValue = 0;
  private nextId = 1;
  private readonly timers = new Map<number, { at: number; callback: () => void }>();

  now = (): number => this.nowValue;

  setTimeout = (callback: () => void, delayMs: number): number => {
    const id = this.nextId++;
    this.timers.set(id, { at: this.nowValue + Math.max(0, delayMs), callback });
    return id;
  };

  clearTimeout = (id: number): void => {
    this.timers.delete(id);
  };

  advanceBy(milliseconds: number): void {
    const target = this.nowValue + milliseconds;
    for (;;) {
      const due = [...this.timers.entries()]
        .filter(([, timer]) => timer.at <= target)
        .sort((a, b) => a[1].at - b[1].at || a[0] - b[0])[0];
      if (!due) break;
      this.timers.delete(due[0]);
      this.nowValue = due[1].at;
      due[1].callback();
    }
    this.nowValue = target;
  }

  get pendingCount(): number {
    return this.timers.size;
  }
}
