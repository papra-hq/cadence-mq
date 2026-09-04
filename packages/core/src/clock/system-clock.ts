import type { Clock, Scheduler } from './clock.types';

export const systemClock: Clock & Scheduler = {
  now: () => Temporal.Now.instant(),
  sleep: async (durationMs, signal) => {
    assertDuration(durationMs);
    if (signal?.aborted === true || durationMs === 0) {
      return Promise.resolve();
    }

    return new Promise((resolve) => {
      const timeout = setTimeout(finish, durationMs);

      function finish(): void {
        clearTimeout(timeout);
        signal?.removeEventListener('abort', finish);
        resolve();
      }

      signal?.addEventListener('abort', finish, { once: true });
    });
  },
};

function assertDuration(durationMs: number): void {
  if (!Number.isSafeInteger(durationMs) || durationMs < 0) {
    throw new RangeError('durationMs must be a non-negative safe integer');
  }
}
