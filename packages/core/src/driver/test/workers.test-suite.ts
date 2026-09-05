import type { Driver } from '../driver';
import type { DriverTestSuiteContext } from './types';
import { describe, expect, test } from 'vitest';
import { createCadence } from '../../client/cadence';
import { createControlledClock } from '../../clock/controlled-clock';
import { defineHandler } from '../../handlers/handler-definition';
import { defineTask } from '../../tasks/task-definition';
import * as v from 'valibot';

const nullPayloadSchema = v.null();

export function registerWorkersTestSuite({
  createDriver,
  testOptions,
}: DriverTestSuiteContext): void {
  describe('workers', () => {
    test('heartbeats renew an active job lease', testOptions, async () => {
      const backingDriver = await createDriver();
      const heartbeat = Promise.withResolvers<ReadonlyArray<string>>();
      const driver = withLeaseRenewalObserver(backingDriver, (renewedIds) => {
        heartbeat.resolve(renewedIds);
      });
      const scheduler = createControlledClock();
      const handlerStarted = Promise.withResolvers<void>();
      const finishHandler = Promise.withResolvers<void>();
      let handlerSignal: AbortSignal | undefined;
      const task = defineTask({
        name: 'driver-test.heartbeat',
        schema: nullPayloadSchema,
        retry: { maxAttempts: 2 },
      });
      const cadence = createCadence({ driver });
      const worker = cadence.createWorker({
        handlers: [
          defineHandler(task, async (_payload, { signal }) => {
            handlerSignal = signal;
            handlerStarted.resolve();
            await finishHandler.promise;
          }),
        ],
        pollingIntervalMs: 100,
        leaseDurationMs: 30_000,
        heartbeatIntervalMs: 10,
        scheduler,
      });

      try {
        const job = await cadence.enqueue(task, null);
        await worker.start();
        await handlerStarted.promise;

        scheduler.advanceBy({ milliseconds: 10 });
        await expect(heartbeat.promise).resolves.toContain(job.id);
        expect(handlerSignal?.aborted).toBe(false);

        finishHandler.resolve();
        await worker.stop();
        expect(await cadence.getJob(job.id)).toMatchObject({
          status: 'succeeded',
          attempts: 1,
        });
      } finally {
        finishHandler.resolve();
        await cadence.close({ gracePeriodMs: 0 });
      }
    });

    test('grace expiry immediately retries or fails active jobs', testOptions, async () => {
      const driver = await createDriver();
      const scheduler = createControlledClock();
      const retryStarted = Promise.withResolvers<void>();
      const failStarted = Promise.withResolvers<void>();
      const retryAborted = Promise.withResolvers<void>();
      const failAborted = Promise.withResolvers<void>();
      const retryTask = defineTask({
        name: 'driver-test.shutdown-retry',
        schema: nullPayloadSchema,
        retry: { maxAttempts: 2 },
      });
      const failTask = defineTask({
        name: 'driver-test.shutdown-fail',
        schema: nullPayloadSchema,
      });
      const cadence = createCadence({ driver });
      const worker = cadence.createWorker({
        handlers: [
          defineHandler(retryTask, async (_payload, { signal }) => {
            retryStarted.resolve();
            signal.addEventListener('abort', () => retryAborted.resolve(), { once: true });
            await new Promise<never>(() => {});
          }),
          defineHandler(failTask, async (_payload, { signal }) => {
            failStarted.resolve();
            signal.addEventListener('abort', () => failAborted.resolve(), { once: true });
            await new Promise<never>(() => {});
          }),
        ],
        concurrency: 2,
        pollingIntervalMs: 100,
        leaseDurationMs: 30_000,
        heartbeatIntervalMs: 100,
        scheduler,
      });

      try {
        const retryJob = await cadence.enqueue(retryTask, null);
        const failJob = await cadence.enqueue(failTask, null);
        await worker.start();
        await Promise.all([retryStarted.promise, failStarted.promise]);

        const stopping = worker.stop({ gracePeriodMs: 20 });
        scheduler.advanceBy({ milliseconds: 20 });
        await Promise.all([retryAborted.promise, failAborted.promise, stopping]);

        expect(await cadence.getJob(retryJob.id)).toMatchObject({
          status: 'pending',
          attempts: 1,
          lastError: { code: 'job.worker-shutdown' },
        });
        expect(await cadence.getJob(failJob.id)).toMatchObject({
          status: 'failed',
          attempts: 1,
          lastError: { code: 'job.worker-shutdown' },
        });
      } finally {
        await cadence.close({ gracePeriodMs: 0 });
      }
    });
  });
}

function withLeaseRenewalObserver(
  driver: Driver,
  observe: (renewedIds: ReadonlyArray<string>) => void,
): Driver {
  return {
    ...driver,
    renewJobLeases: async (options) => {
      const renewedIds = await driver.renewJobLeases(options);
      observe(renewedIds);
      return renewedIds;
    },
  };
}
