import { describe, expect, test } from 'vitest';
import { createControlledClock } from './controlled-clock';
import { systemClock } from './system-clock';

describe('controlled-clock', () => {
  describe('createControlledClock', () => {
    test('by default the controlled clock is set to 2026-05-12T00:00:00Z', () => {
      const clock = createControlledClock();

      expect(clock.now().toString()).to.eql('2026-05-12T00:00:00Z');
      expect(clock.now().toString()).to.eql('2026-05-12T00:00:00Z');
    });

    test('the controlled clock can be set to a specific date', () => {
      const clock = createControlledClock({ now: '2023-01-01T00:00:00Z' });

      expect(clock.now().toString()).to.eql('2023-01-01T00:00:00Z');
    });

    test('the controlled clock can be advanced by a duration', () => {
      const clock = createControlledClock({ now: '2023-01-01T00:00:00Z' });

      clock.advanceBy({ hours: 24 });

      expect(clock.now().toString()).to.eql('2023-01-02T00:00:00Z');
    });

    test('the controlled clock can be set to a specific date after being created', () => {
      const clock = createControlledClock({ now: '2023-01-01T00:00:00Z' });

      clock.setNow('2023-01-02T00:00:00Z');

      expect(clock.now().toString()).to.eql('2023-01-02T00:00:00Z');
    });

    test('sleep resolves only after the controlled deadline is reached', async () => {
      const clock = createControlledClock({ now: '2023-01-01T00:00:00Z' });
      let settled = false;
      const sleep = clock.sleep(1_000).then(() => {
        settled = true;
      });

      clock.advanceBy({ milliseconds: 999 });
      await Promise.resolve();
      expect(settled).toBe(false);

      clock.advanceBy({ milliseconds: 1 });
      await sleep;
      expect(settled).toBe(true);
    });

    test('aborting sleep resolves it without advancing the clock', async () => {
      const clock = createControlledClock({ now: '2023-01-01T00:00:00Z' });
      const controller = new AbortController();
      const sleep = clock.sleep(1_000, controller.signal);

      controller.abort();

      await expect(sleep).resolves.toBeUndefined();
      expect(clock.now().toString()).toBe('2023-01-01T00:00:00Z');
    });
  });

  test.each([createControlledClock(), systemClock])(
    'scheduler %# rejects invalid durations consistently',
    async (scheduler) => {
      await expect(scheduler.sleep(-1)).rejects.toBeInstanceOf(RangeError);
      await expect(scheduler.sleep(1.5)).rejects.toBeInstanceOf(RangeError);
      await expect(scheduler.sleep(Number.POSITIVE_INFINITY)).rejects.toBeInstanceOf(RangeError);
    },
  );
});
