import type { ProviderAttemptError, ProviderErrorCategory } from "../providers/types.js";

export function parseRetryAfter(value: string | undefined, nowMs = Date.now()): number | undefined {
  if (!value) return undefined;
  if (/^\d+(?:\.\d+)?$/.test(value.trim())) {
    const milliseconds = Number(value) * 1_000;
    return Number.isFinite(milliseconds) && milliseconds >= 0 ? milliseconds : undefined;
  }
  const date = Date.parse(value);
  if (!Number.isFinite(date) || date < nowMs) return undefined;
  return date - nowMs;
}

export function retryDelayMs(
  retryNumber: 1 | 2 | 3,
  random: () => number,
  retryAfterMs?: number,
): number {
  const base = [1_000, 2_000, 4_000][retryNumber - 1];
  if (base === undefined) throw new Error("Retry number must be 1–3");
  const jitter = Math.floor(base * 0.25 * Math.min(1, Math.max(0, random())));
  return Math.max(base + jitter, retryAfterMs ?? 0);
}

export function classifyAttemptFailure(input: {
  category?: ProviderErrorCategory;
  statusCode?: number;
  providerCode?: string;
  retryAfterMs?: number;
}): ProviderAttemptError {
  const status = input.statusCode;
  const code = input.providerCode?.toLowerCase();
  if (code && /(insufficient_quota|billing|spend|usage_quota)/.test(code)) {
    return {
      category: "quota",
      retryable: false,
      ...(status === undefined ? {} : { statusCode: status }),
      providerCode: input.providerCode!,
      userAction: "CHECK_QUOTA",
    };
  }
  if (status === 401 || status === 403) {
    return {
      category: "authentication",
      retryable: false,
      statusCode: status,
      userAction: "CHECK_CREDENTIALS",
    };
  }
  if (status === 402) {
    return {
      category: "quota",
      retryable: false,
      statusCode: status,
      userAction: "CHECK_QUOTA",
    };
  }
  if (input.category === "timeout" || input.category === "network") {
    return {
      category: input.category,
      retryable: true,
      ...(input.retryAfterMs === undefined ? {} : { retryAfterMs: input.retryAfterMs }),
      userAction: "CHECK_NETWORK",
    };
  }
  const retryable =
    status === 408 ||
    status === 429 ||
    status === 500 ||
    status === 502 ||
    status === 503 ||
    status === 504 ||
    status === 529;
  return {
    category:
      input.category ?? (status === 504 ? "timeout" : status === undefined ? "protocol" : "http"),
    retryable,
    ...(status === undefined ? {} : { statusCode: status }),
    ...(input.providerCode === undefined ? {} : { providerCode: input.providerCode }),
    ...(input.retryAfterMs === undefined ? {} : { retryAfterMs: input.retryAfterMs }),
    userAction: retryable ? "CHECK_NETWORK" : "CHECK_ENDPOINT",
  };
}

export interface RetryClock {
  setTimeout(callback: () => void, delayMs: number): number;
  clearTimeout(id: number): void;
}

export class RetryTimerSet {
  private readonly ids = new Set<number>();
  constructor(private readonly clock: RetryClock) {}

  schedule(delayMs: number, callback: () => void): number {
    const id = this.clock.setTimeout(() => {
      this.ids.delete(id);
      callback();
    }, delayMs);
    this.ids.add(id);
    return id;
  }

  cancelAll(): void {
    for (const id of this.ids) this.clock.clearTimeout(id);
    this.ids.clear();
  }

  get size(): number {
    return this.ids.size;
  }
}
