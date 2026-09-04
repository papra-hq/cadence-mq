import type { Clock, Scheduler } from './clock.types';

export type ControlledClock = Clock &
  Scheduler & {
    setNow: (instant: Temporal.InstantLike) => void;
    advanceBy: (duration: Temporal.DurationLike) => void;
  };

type PendingSleep = {
  deadline: Temporal.Instant;
  finish: () => void;
};

export function createControlledClock({
  now = Temporal.Instant.from('2026-05-12T00:00:00Z'),
}: { now?: Temporal.InstantLike } = {}): ControlledClock {
  let current: Temporal.Instant = Temporal.Instant.from(now);
  const pendingSleeps = new Set<PendingSleep>();

  const flush = (): void => {
    const dueSleeps = [...pendingSleeps]
      .filter(({ deadline }) => Temporal.Instant.compare(deadline, current) <= 0)
      .sort(({ deadline: left }, { deadline: right }) => Temporal.Instant.compare(left, right));

    for (const sleep of dueSleeps) {
      sleep.finish();
    }
  };

  return {
    now: () => current,
    sleep: async (durationMs, signal) => {
      assertDuration(durationMs);
      if (signal?.aborted === true || durationMs === 0) {
        return Promise.resolve();
      }

      return new Promise((resolve) => {
        const sleep: PendingSleep = {
          deadline: current.add({ milliseconds: durationMs }),
          finish,
        };

        function finish(): void {
          if (!pendingSleeps.delete(sleep)) {
            return;
          }
          signal?.removeEventListener('abort', finish);
          resolve();
        }

        pendingSleeps.add(sleep);
        signal?.addEventListener('abort', finish, { once: true });
      });
    },
    setNow: (instant: Temporal.InstantLike) => {
      current = Temporal.Instant.from(instant);
      flush();
    },
    advanceBy: (duration: Temporal.DurationLike) => {
      current = current.add(duration);
      flush();
    },
  };
}

function assertDuration(durationMs: number): void {
  if (!Number.isSafeInteger(durationMs) || durationMs < 0) {
    throw new RangeError('durationMs must be a non-negative safe integer');
  }
}
