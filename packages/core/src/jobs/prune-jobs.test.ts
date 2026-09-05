import type { Driver, PruneJobsOptions } from '../index';
import { describe, expect, test } from 'vitest';
import { createCadence } from '../index';

function recordingDriver() {
  let initializations = 0;
  let pruneOptions: PruneJobsOptions | undefined;
  const driver: Driver = {
    name: 'prune-recording',
    initialize: async () => {
      initializations += 1;
    },
    close: async () => {},
    now: async () => Temporal.Instant.from('2026-01-01T00:00:00Z'),
    insertJob: async () => {
      throw new Error('not implemented');
    },
    getJob: async () => undefined,
    pruneJobs: async (options) => {
      pruneOptions = options;
      return 7;
    },
    claimJobs: async () => [],
    renewJobLeases: async () => [],
    completeJob: async () => false,
    retryJob: async () => false,
    failJob: async () => false,
    upsertSchedule: async () => {
      throw new Error('not implemented');
    },
    getSchedule: async () => undefined,
    deleteSchedule: async () => false,
    claimDueSchedules: async () => [],
    commitScheduleOccurrence: async () => false,
    releaseScheduleClaim: async () => false,
  };

  return {
    driver,
    initializations: () => initializations,
    pruneOptions: () => pruneOptions,
  };
}

describe('job pruning client', () => {
  test('the cutoff is normalized and pruning defaults are passed to the driver', async () => {
    const recording = recordingDriver();
    const cadence = createCadence({ driver: recording.driver });

    await expect(cadence.pruneJobs({ before: '2026-01-01T00:00:00.000999999Z' })).resolves.toBe(7);

    expect(recording.pruneOptions()).toEqual({
      before: Temporal.Instant.from('2026-01-01T00:00:00Z'),
      statuses: ['succeeded', 'failed'],
      limit: 1_000,
    });
    expect(recording.initializations()).toBe(1);
  });

  test('explicit statuses and the maximum limit are passed to the driver', async () => {
    const recording = recordingDriver();
    const cadence = createCadence({ driver: recording.driver });

    await cadence.pruneJobs({
      before: '2026-01-01T00:00:00Z',
      statuses: ['failed'],
      limit: 10_000,
    });

    expect(recording.pruneOptions()).toMatchObject({ statuses: ['failed'], limit: 10_000 });
  });

  test.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, 10_001])(
    'invalid prune limit %s is rejected before driver work',
    async (limit) => {
      const recording = recordingDriver();
      const cadence = createCadence({ driver: recording.driver });

      await expect(
        cadence.pruneJobs({ before: '2026-01-01T00:00:00Z', limit }),
      ).rejects.toMatchObject({ code: 'job.invalid-prune-options' });
      expect(recording.initializations()).toBe(0);
      expect(recording.pruneOptions()).toBeUndefined();
    },
  );

  test('non-terminal status filters are rejected before driver work', async () => {
    const recording = recordingDriver();
    const cadence = createCadence({ driver: recording.driver });

    await expect(
      cadence.pruneJobs({
        before: '2026-01-01T00:00:00Z',
        statuses: ['running'],
      } as unknown as PruneJobsOptions),
    ).rejects.toMatchObject({ code: 'job.invalid-prune-options' });
    expect(recording.initializations()).toBe(0);
    expect(recording.pruneOptions()).toBeUndefined();
  });
});
