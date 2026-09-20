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

const defaultHostTimerApi: HostTimerApi = {
  setTimeout: (callback, delayMs) => setTimeout(callback, delayMs),
  clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
  setInterval: (callback, delayMs) => setInterval(callback, delayMs),
  clearInterval: (handle) => clearInterval(handle as ReturnType<typeof setInterval>),
};

export class HostTimers {
  constructor(private readonly api: HostTimerApi = defaultHostTimerApi) {}

  setTimeout(callback: () => void, delayMs: number): HostTimeout {
    let active = true;
    const registration: HostTimeout = {
      get active() {
        return active;
      },
      cancel: () => {
        if (!active) return;
        active = false;
        this.api.clearTimeout(handle);
      },
    };
    const handle = this.api.setTimeout(() => {
      if (!active) return;
      active = false;
      this.api.clearTimeout(handle);
      callback();
    }, delayMs);
    return registration;
  }

  setInterval(callback: () => void, delayMs: number): HostInterval {
    let active = true;
    const handle = this.api.setInterval(() => {
      if (active) callback();
    }, delayMs);
    return {
      get active() {
        return active;
      },
      cancel: () => {
        if (!active) return;
        active = false;
        this.api.clearInterval(handle);
      },
    };
  }

  delay(delayMs: number): Promise<void> {
    return new Promise((resolve) => this.setTimeout(resolve, delayMs));
  }
}

export const hostTimers = new HostTimers();
