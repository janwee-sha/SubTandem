export interface HostTimerApi {
  setTimeout(callback: () => void, delayMs: number): unknown;
  clearTimeout(handle: unknown): void;
  setInterval(callback: () => void, delayMs: number): unknown;
  clearInterval(handle: unknown): void;
}

export interface HostTimeout {
  readonly active: boolean;
  cancel(): void;
}

export interface HostInterval {
  readonly active: boolean;
  cancel(): void;
}

export class HostClock implements HostTimerApi {
  private sequence = 0;
  private readonly pending = new Map<
    number,
    { callback: () => void; due: number; interval: number | null }
  >();
  constructor(private readonly now: () => number = () => Date.now()) {}
  setTimeout(callback: () => void, delayMs: number): unknown {
    return this.register(callback, delayMs, null);
  }
  setInterval(callback: () => void, delayMs: number): unknown {
    return this.register(callback, delayMs, Math.max(1, delayMs));
  }
  clearTimeout(handle: unknown): void {
    this.pending.delete(handle as number);
  }
  clearInterval(handle: unknown): void {
    this.pending.delete(handle as number);
  }
  private register(callback: () => void, delayMs: number, interval: number | null): number {
    const id = ++this.sequence;
    this.pending.set(id, { callback, due: this.now() + Math.max(0, delayMs), interval });
    return id;
  }
  pulse(): void {
    const now = this.now();
    for (const [id, entry] of [...this.pending]) {
      if (entry.due > now || !this.pending.has(id)) continue;
      if (entry.interval === null) this.pending.delete(id);
      else entry.due = now + entry.interval;
      entry.callback();
    }
  }
}

export const hostClock = new HostClock();
const nativeHostTimerApi: HostTimerApi = {
  setTimeout: (callback, delayMs) => setTimeout(callback, delayMs),
  clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
  setInterval: (callback, delayMs) => setInterval(callback, delayMs),
  clearInterval: (handle) => clearInterval(handle as ReturnType<typeof setInterval>),
};

export class HostTimers {
  constructor(private readonly api?: HostTimerApi) {}

  private backend(): HostTimerApi {
    return this.api ?? (typeof iina === "undefined" ? nativeHostTimerApi : hostClock);
  }

  setTimeout(callback: () => void, delayMs: number): HostTimeout {
    const api = this.backend();
    let active = true;
    const registration: HostTimeout = {
      get active() {
        return active;
      },
      cancel: () => {
        if (!active) return;
        active = false;
        api.clearTimeout(handle);
      },
    };
    const handle = api.setTimeout(() => {
      if (!active) return;
      active = false;
      api.clearTimeout(handle);
      callback();
    }, delayMs);
    return registration;
  }

  setInterval(callback: () => void, delayMs: number): HostInterval {
    const api = this.backend();
    let active = true;
    const handle = api.setInterval(() => {
      if (active) callback();
    }, delayMs);
    return {
      get active() {
        return active;
      },
      cancel: () => {
        if (!active) return;
        active = false;
        api.clearInterval(handle);
      },
    };
  }

  delay(delayMs: number): Promise<void> {
    return new Promise((resolve) => this.setTimeout(resolve, delayMs));
  }
}

export const hostTimers = new HostTimers();
