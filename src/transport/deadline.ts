import { hostTimers } from "../adapters/iina/host-timers.js";
import { SubTandemError } from "../domain/errors.js";

export function assertProfileDeadline(deadlineMs: number): void {
  if (!Number.isSafeInteger(deadlineMs) || Date.now() >= deadlineMs)
    throw new SubTandemError("HELPER_UNAVAILABLE", "network", "RESTART_IINA");
}

export async function withinProfileDeadline<T>(
  operation: Promise<T>,
  deadlineMs: number,
): Promise<T> {
  assertProfileDeadline(deadlineMs);
  let timeout: ReturnType<typeof hostTimers.setTimeout> | undefined;
  try {
    const expired = new Promise<never>((_resolve, reject) => {
      timeout = hostTimers.setTimeout(
        () => reject(new SubTandemError("HELPER_UNAVAILABLE", "network", "RESTART_IINA")),
        deadlineMs - Date.now(),
      );
    });
    const result = await Promise.race([operation, expired]);
    assertProfileDeadline(deadlineMs);
    return result;
  } finally {
    timeout?.cancel();
  }
}
