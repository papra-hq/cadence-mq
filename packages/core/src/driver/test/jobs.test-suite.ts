import type { DriverTestSuiteContext } from './types';
import { describe, expect, test } from 'vitest';
import { createCadence } from '../../client/cadence';
import { defineHandler } from '../../handlers/handler-definition';
import { defineTask } from '../../tasks/task-definition';
import * as v from 'valibot';

const objectPayloadSchema = v.object({ value: v.string() });

export function registerJobsTestSuite({ createDriver, testOptions }: DriverTestSuiteContext): void {
  describe('jobs', () => {
    test(
      'define, enqueue, execute, complete, and inspect reaches succeeded',
      testOptions,
      async () => {
        const driver = await createDriver();
        const cadence = createCadence({ driver });
        const handled = Promise.withResolvers<{ value: string }>();
        const task = defineTask({
          name: 'driver-test.fundamental',
          schema: objectPayloadSchema,
        });
        const worker = cadence.createWorker({
          handlers: [
            defineHandler(task, (payload) => {
              handled.resolve(payload);
            }),
          ],
          pollingIntervalMs: 60_000,
          leaseDurationMs: 30_000,
        });

        try {
          const job = await cadence.enqueue(task, { value: 'work' });
          expect(job).toMatchObject({
            taskName: task.name,
            payload: { value: 'work' },
            status: 'pending',
            attempts: 0,
          });

          await worker.start();
          await expect(handled.promise).resolves.toEqual({ value: 'work' });
          await worker.stop();

          expect(await cadence.getJob(job.id)).toMatchObject({
            id: job.id,
            taskName: task.name,
            payload: { value: 'work' },
            status: 'succeeded',
            attempts: 1,
          });
        } finally {
          await cadence.close({ gracePeriodMs: 0 });
        }
      },
    );
  });
}
