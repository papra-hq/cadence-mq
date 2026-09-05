import type { Driver } from '../driver';
import type { Job } from '../../jobs/job';
import type { DriverTestSuiteContext } from './types';
import { describe, expect, test } from 'vitest';
import { createCadence } from '../../client/cadence';
import { occurrenceJob, scheduleUpsert } from './helpers';

export function registerPruningTestSuite({
  createDriver,
  testOptions,
}: DriverTestSuiteContext): void {
  describe('pruning', () => {
    test('pruning uses a strict, millisecond-normalized before boundary', testOptions, async () => {
      const driver = await createDriver();
      const cadence = createCadence({ driver });

      try {
        await driver.initialize();
        const job = await createTerminalJob(driver, 'driver-test.prune-boundary', 'succeeded');
        const finishedAt = requiredFinishedAt(job);

        expect(await cadence.pruneJobs({ before: finishedAt })).toBe(0);
        expect(await cadence.pruneJobs({ before: finishedAt.add({ nanoseconds: 999_999 }) })).toBe(
          0,
        );
        expect(await cadence.getJob(job.id)).toBeDefined();

        expect(await cadence.pruneJobs({ before: finishedAt.add({ milliseconds: 1 }) })).toBe(1);
        expect(await cadence.getJob(job.id)).toBeUndefined();
      } finally {
        await cadence.close({ gracePeriodMs: 0 });
      }
    });

    test(
      'pruning defaults to both terminal statuses and honors explicit filters',
      testOptions,
      async () => {
        const driver = await createDriver();
        const cadence = createCadence({ driver });

        try {
          await driver.initialize();
          const defaultSucceeded = await createTerminalJob(
            driver,
            'driver-test.prune-default-succeeded',
            'succeeded',
          );
          const defaultFailed = await createTerminalJob(
            driver,
            'driver-test.prune-default-failed',
            'failed',
          );
          expect(
            await cadence.pruneJobs({ before: cutoffAfter([defaultSucceeded, defaultFailed]) }),
          ).toBe(2);
          expect(await cadence.getJob(defaultSucceeded.id)).toBeUndefined();
          expect(await cadence.getJob(defaultFailed.id)).toBeUndefined();

          const filteredSucceeded = await createTerminalJob(
            driver,
            'driver-test.prune-filtered-succeeded',
            'succeeded',
          );
          const filteredFailed = await createTerminalJob(
            driver,
            'driver-test.prune-filtered-failed',
            'failed',
          );
          expect(
            await cadence.pruneJobs({
              before: cutoffAfter([filteredSucceeded, filteredFailed]),
              statuses: ['failed'],
            }),
          ).toBe(1);
          expect(await cadence.getJob(filteredSucceeded.id)).toBeDefined();
          expect(await cadence.getJob(filteredFailed.id)).toBeUndefined();
        } finally {
          await cadence.close({ gracePeriodMs: 0 });
        }
      },
    );

    test('pruning is bounded and ordered by finish time and ID', testOptions, async () => {
      const driver = await createDriver();
      const cadence = createCadence({ driver });

      try {
        await driver.initialize();
        const jobs = await Promise.all(
          ['c', 'a', 'b'].map(async (suffix) =>
            createTerminalJob(driver, `driver-test.prune-limit-${suffix}`, 'succeeded'),
          ),
        );
        const ordered = [...jobs].sort(compareFinishedJobs);
        const cutoff = cutoffAfter(jobs);

        expect(await cadence.pruneJobs({ before: cutoff, limit: 2 })).toBe(2);
        expect(await cadence.getJob(ordered[0]?.id ?? '')).toBeUndefined();
        expect(await cadence.getJob(ordered[1]?.id ?? '')).toBeUndefined();
        expect(await cadence.getJob(ordered[2]?.id ?? '')).toBeDefined();
        expect(await cadence.pruneJobs({ before: cutoff })).toBe(1);
      } finally {
        await cadence.close({ gracePeriodMs: 0 });
      }
    });

    test('pruning never removes pending or running jobs', testOptions, async () => {
      const driver = await createDriver();
      const cadence = createCadence({ driver });

      try {
        await driver.initialize();
        const pending = await insertPruneJob(driver, 'driver-test.prune-pending');
        const running = await insertPruneJob(driver, 'driver-test.prune-running');
        const [runningClaim] = await driver.claimJobs({
          taskNames: [running.taskName],
          limit: 1,
          leaseDurationMs: 30_000,
        });
        if (runningClaim?.id !== running.id) {
          throw new Error('Expected the running prune test job to be claimed');
        }
        const terminal = await createTerminalJob(driver, 'driver-test.prune-terminal', 'succeeded');

        expect(await cadence.pruneJobs({ before: cutoffAfter([terminal]) })).toBe(1);
        expect(await cadence.getJob(pending.id)).toMatchObject({ status: 'pending' });
        expect(await cadence.getJob(running.id)).toMatchObject({ status: 'running' });
        expect(await cadence.getJob(terminal.id)).toBeUndefined();
      } finally {
        await cadence.close({ gracePeriodMs: 0 });
      }
    });

    test('pruning a schedule occurrence leaves its schedule unchanged', testOptions, async () => {
      const driver = await createDriver();
      const cadence = createCadence({ driver });

      try {
        await driver.initialize();
        await driver.upsertSchedule(await scheduleUpsert(driver));
        const [scheduleClaim] = await driver.claimDueSchedules({
          limit: 1,
          leaseDurationMs: 30_000,
        });
        if (scheduleClaim === undefined) {
          throw new Error('Expected a schedule claim for the prune test');
        }

        const occurrence = occurrenceJob(
          'driver-test.pruned-schedule-occurrence',
          scheduleClaim.nextRunAt,
        );
        expect(
          await driver.commitScheduleOccurrence({
            lease: { id: scheduleClaim.id, token: scheduleClaim.leaseToken },
            job: occurrence,
            nextRunAt: scheduleClaim.nextRunAt.add({ minutes: 1 }),
          }),
        ).toBe(true);
        const [jobClaim] = await driver.claimJobs({
          taskNames: [occurrence.taskName],
          limit: 1,
          leaseDurationMs: 30_000,
        });
        if (jobClaim?.id !== occurrence.id) {
          throw new Error('Expected the schedule occurrence to be claimed');
        }
        expect(await driver.completeJob({ id: jobClaim.id, token: jobClaim.leaseToken })).toBe(
          true,
        );
        const terminal = await driver.getJob(occurrence.id);
        if (terminal === undefined) {
          throw new Error('Expected a terminal schedule occurrence');
        }
        const scheduleBeforePrune = await driver.getSchedule(scheduleClaim.id);

        expect(await cadence.pruneJobs({ before: cutoffAfter([terminal]) })).toBe(1);
        expect(await cadence.getJob(occurrence.id)).toBeUndefined();
        expect(await cadence.schedules.get(scheduleClaim.id)).toEqual(scheduleBeforePrune);
      } finally {
        await cadence.close({ gracePeriodMs: 0 });
      }
    });
  });
}

async function insertPruneJob(driver: Driver, id: string): Promise<Job> {
  return driver.insertJob({
    id,
    taskName: id,
    payload: null,
    retry: { maxAttempts: 1 },
    availableAt: await driver.now(),
  });
}

async function createTerminalJob(
  driver: Driver,
  id: string,
  status: 'succeeded' | 'failed',
): Promise<Job> {
  const inserted = await insertPruneJob(driver, id);
  const [claim] = await driver.claimJobs({
    taskNames: [inserted.taskName],
    limit: 1,
    leaseDurationMs: 30_000,
  });
  if (claim?.id !== id) {
    throw new Error(`Expected prune test job ${id} to be claimed`);
  }

  const transitioned =
    status === 'succeeded'
      ? await driver.completeJob({ id, token: claim.leaseToken })
      : await driver.failJob({
          lease: { id, token: claim.leaseToken },
          error: { name: 'Error', message: 'prune test failure' },
        });
  if (!transitioned) {
    throw new Error(`Expected prune test job ${id} to become ${status}`);
  }

  const terminal = await driver.getJob(id);
  if (terminal === undefined || terminal.status !== status || terminal.finishedAt === undefined) {
    throw new Error(`Expected prune test job ${id} to be terminal`);
  }
  return terminal;
}

function requiredFinishedAt(job: Job): Temporal.Instant {
  if (job.finishedAt === undefined) {
    throw new Error(`Expected job ${job.id} to have a finish time`);
  }
  return job.finishedAt;
}

function cutoffAfter(jobs: ReadonlyArray<Job>): Temporal.Instant {
  const latest = jobs
    .map(requiredFinishedAt)
    .sort((left, right) => Temporal.Instant.compare(left, right))
    .at(-1);
  if (latest === undefined) {
    throw new Error('Expected at least one terminal job');
  }
  return latest.add({ milliseconds: 1 });
}

function compareFinishedJobs(left: Job, right: Job): number {
  const finished = Temporal.Instant.compare(requiredFinishedAt(left), requiredFinishedAt(right));
  return finished === 0 ? left.id.localeCompare(right.id) : finished;
}
