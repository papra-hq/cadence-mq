import type { Driver } from '../driver';
import type { DriverTestSuiteContext } from './types';
import { describe, expect, test } from 'vitest';
import { createCadence } from '../../client/cadence';
import { createControlledClock } from '../../clock/controlled-clock';
import { occurrenceJob, scheduleUpsert, testScheduleId, testScheduleTaskName } from './helpers';

export function registerSchedulesTestSuite({
  createDriver,
  testOptions,
}: DriverTestSuiteContext): void {
  describe('schedules', () => {
    test('schedule upserts preserve cursors and isolate stored values', testOptions, async () => {
      const driver = await createDriver();

      try {
        await driver.initialize();
        const input = await scheduleUpsert(driver);
        const created = await driver.upsertSchedule(input);
        (input.payload as { nested: { value: string } }).nested.value = 'input mutation';
        (created.payload as { nested: { value: string } }).nested.value = 'return mutation';
        expect((await driver.getSchedule(input.id))?.payload).toEqual({
          nested: { value: 'original' },
        });

        const preservedCandidate = created.nextRunAt.add({ hours: 2 });
        const equivalent = await driver.upsertSchedule(
          await scheduleUpsert(driver, {
            payload: { nested: { value: 'updated' } },
            nextRunAt: preservedCandidate,
          }),
        );
        expect(equivalent.nextRunAt.equals(created.nextRunAt)).toBe(true);
        (equivalent.payload as { nested: { value: string } }).nested.value = 'return mutation';
        expect((await driver.getSchedule(input.id))?.payload).toEqual({
          nested: { value: 'updated' },
        });

        const resetCandidate = created.nextRunAt.add({ hours: 3 });
        const reset = await driver.upsertSchedule(
          await scheduleUpsert(driver, {
            trigger: { cron: '* * * * *', timeZone: 'Europe/Paris' },
            nextRunAt: resetCandidate,
          }),
        );
        expect(reset.nextRunAt.equals(resetCandidate)).toBe(true);
      } finally {
        await driver.close();
      }
    });

    test(
      'expired schedule claims are reclaimed and stale leases are rejected',
      testOptions,
      async () => {
        const driver = await createDriver();

        try {
          await driver.initialize();
          await driver.upsertSchedule(await scheduleUpsert(driver));
          const [expired] = await driver.claimDueSchedules({ limit: 1, leaseDurationMs: 0 });
          const [current] = await driver.claimDueSchedules({ limit: 1, leaseDurationMs: 30_000 });
          if (expired === undefined || current === undefined) {
            throw new Error('Expected expired and current schedule claims');
          }

          expect(current.leaseToken).not.toBe(expired.leaseToken);
          expect(
            await driver.releaseScheduleClaim({ id: expired.id, token: expired.leaseToken }),
          ).toBe(false);
          expect(
            await driver.releaseScheduleClaim({ id: current.id, token: current.leaseToken }),
          ).toBe(true);
        } finally {
          await driver.close();
        }
      },
    );

    test('concurrent schedule commits create and advance one occurrence', testOptions, async () => {
      const driver = await createDriver();

      try {
        await driver.initialize();
        await driver.upsertSchedule(await scheduleUpsert(driver));
        const [claim] = await driver.claimDueSchedules({ limit: 1, leaseDurationMs: 30_000 });
        if (claim === undefined) {
          throw new Error('Expected a schedule claim');
        }
        const lease = { id: claim.id, token: claim.leaseToken };
        const nextRunAt = claim.nextRunAt.add({ minutes: 1 });

        const results = await Promise.all([
          driver.commitScheduleOccurrence({
            lease,
            job: occurrenceJob('driver-test.occurrence-1', claim.nextRunAt),
            nextRunAt,
          }),
          driver.commitScheduleOccurrence({
            lease,
            job: occurrenceJob('driver-test.occurrence-2', claim.nextRunAt),
            nextRunAt,
          }),
        ]);

        expect(results.filter(Boolean)).toHaveLength(1);
        const jobs = await Promise.all([
          driver.getJob('driver-test.occurrence-1'),
          driver.getJob('driver-test.occurrence-2'),
        ]);
        expect(jobs.filter((job) => job !== undefined)).toHaveLength(1);
        expect(jobs.find((job) => job !== undefined)).toMatchObject({
          schedule: { id: claim.id, occurrenceAt: claim.nextRunAt },
        });
        expect((await driver.getSchedule(claim.id))?.nextRunAt.equals(nextRunAt)).toBe(true);
      } finally {
        await driver.close();
      }
    });

    test(
      'duplicate schedule occurrences leave the cursor and lease unchanged',
      testOptions,
      async () => {
        const driver = await createDriver();

        try {
          await driver.initialize();
          const schedule = await scheduleUpsert(driver);
          await driver.insertJob(
            occurrenceJob('driver-test.existing-occurrence', schedule.nextRunAt),
          );
          await driver.upsertSchedule(schedule);
          const [claim] = await driver.claimDueSchedules({ limit: 1, leaseDurationMs: 30_000 });
          if (claim === undefined) {
            throw new Error('Expected a schedule claim');
          }

          await expect(
            driver.commitScheduleOccurrence({
              lease: { id: claim.id, token: claim.leaseToken },
              job: occurrenceJob('driver-test.duplicate-occurrence', claim.nextRunAt),
              nextRunAt: claim.nextRunAt.add({ minutes: 1 }),
            }),
          ).rejects.toBeDefined();
          expect(await driver.getJob('driver-test.duplicate-occurrence')).toBeUndefined();
          expect((await driver.getSchedule(claim.id))?.nextRunAt.equals(claim.nextRunAt)).toBe(
            true,
          );
          expect(await driver.releaseScheduleClaim({ id: claim.id, token: claim.leaseToken })).toBe(
            true,
          );
        } finally {
          await driver.close();
        }
      },
    );

    test('deleting a schedule retains jobs and invalidates its lease', testOptions, async () => {
      const driver = await createDriver();

      try {
        await driver.initialize();
        await driver.upsertSchedule(await scheduleUpsert(driver));
        const [materializedClaim] = await driver.claimDueSchedules({
          limit: 1,
          leaseDurationMs: 30_000,
        });
        if (materializedClaim === undefined) {
          throw new Error('Expected a schedule claim');
        }
        await driver.commitScheduleOccurrence({
          lease: { id: materializedClaim.id, token: materializedClaim.leaseToken },
          job: occurrenceJob('driver-test.retained-occurrence', materializedClaim.nextRunAt),
          nextRunAt: materializedClaim.nextRunAt.add({ minutes: 1 }),
        });

        await driver.upsertSchedule(
          await scheduleUpsert(driver, {
            trigger: { cron: '* * * * *', timeZone: 'Europe/Paris' },
          }),
        );
        const [deletedClaim] = await driver.claimDueSchedules({
          limit: 1,
          leaseDurationMs: 30_000,
        });
        if (deletedClaim === undefined) {
          throw new Error('Expected a schedule claim before deletion');
        }

        expect(await driver.deleteSchedule(deletedClaim.id)).toBe(true);
        expect(await driver.deleteSchedule(deletedClaim.id)).toBe(false);
        expect(
          await driver.releaseScheduleClaim({
            id: deletedClaim.id,
            token: deletedClaim.leaseToken,
          }),
        ).toBe(false);
        expect(await driver.getJob('driver-test.retained-occurrence')).toBeDefined();
      } finally {
        await driver.close();
      }
    });

    test(
      'a worker materializes only the latest missed schedule occurrence',
      testOptions,
      async () => {
        const backingDriver = await createDriver();
        let claimedAt: Temporal.Instant | undefined;
        const observedDriver: Driver = {
          ...backingDriver,
          claimDueSchedules: async (options) => {
            const claims = await backingDriver.claimDueSchedules(options);
            claimedAt ??= claims[0]?.claimedAt;
            return claims;
          },
        };
        const cadence = createCadence({ driver: observedDriver });
        const worker = cadence.createWorker({
          handlers: [],
          scheduler: createControlledClock(),
          pollingIntervalMs: 1_000,
        });

        try {
          await backingDriver.initialize();
          const now = await backingDriver.now();
          const latestBoundary = Temporal.Instant.fromEpochMilliseconds(
            Math.floor(now.epochMilliseconds / 1_000) * 1_000,
          );
          await backingDriver.upsertSchedule(
            await scheduleUpsert(backingDriver, {
              trigger: { cron: '* * * * * *', timeZone: 'UTC' },
              nextRunAt: latestBoundary.subtract({ seconds: 3 }),
            }),
          );
          await worker.start();
          await settleUntil(async () =>
            Boolean((await cadence.schedules.get(testScheduleId))?.lastMaterializedAt),
          );
          await worker.stop({ gracePeriodMs: 0 });
          if (claimedAt === undefined) {
            throw new Error('Expected an observed schedule claim');
          }
          const latestOccurrence = Temporal.Instant.fromEpochMilliseconds(
            Math.floor(claimedAt.epochMilliseconds / 1_000) * 1_000,
          );
          const [job] = await backingDriver.claimJobs({
            taskNames: [testScheduleTaskName],
            limit: 1,
            leaseDurationMs: 30_000,
          });

          expect(job?.schedule?.occurrenceAt.equals(latestOccurrence)).toBe(true);
          expect(
            (await backingDriver.getSchedule(testScheduleId))?.nextRunAt.equals(
              latestOccurrence.add({ seconds: 1 }),
            ),
          ).toBe(true);
        } finally {
          await cadence.close({ gracePeriodMs: 0 });
        }
      },
    );
  });
}

async function settleUntil(predicate: () => Promise<boolean>): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (await predicate()) {
      return;
    }
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
  throw new Error('Condition did not settle');
}
