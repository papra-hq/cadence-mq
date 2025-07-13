import type { TestSuite } from '../types';
import { createCadence } from '@cadence-mq/core';
import { describe, expect, test } from 'vitest';

export const testScheduledJobs: TestSuite = ({ createDriver, processingLatencyMs = 0 }) => {
  describe('scheduled jobs', () => {
    test('a job can be scheduled in the future', async () => {
      const { driver } = await createDriver();
      const cadence = createCadence({ driver });

      const scheduledAt = new Date(Date.now() + 50);
      const { promise, resolve } = Promise.withResolvers<Date>();

      cadence.registerTask({
        taskName: 'test',
        handler: async () => {
          resolve(new Date());
        },
      });

      const worker = cadence.createWorker({ workerId: 'worker-1' });
      worker.start();

      await cadence.scheduleJob({
        taskName: 'test',
        data: {},
        scheduledAt,
      });

      const runAt = await promise;

      expect(runAt.getTime()).toBeGreaterThanOrEqual(scheduledAt.getTime());
    });

    test('a job scheduled in the past is run immediately', async () => {
      const { driver } = await createDriver();
      const cadence = createCadence({ driver });

      const scheduledAt = new Date(Date.now() - 1000 * 60);
      const { promise, resolve } = Promise.withResolvers<Date>();

      cadence.registerTask({
        taskName: 'test',
        handler: async () => {
          resolve(new Date());
        },
      });

      const worker = cadence.createWorker({ workerId: 'worker-1' });
      worker.start();

      await cadence.scheduleJob({
        taskName: 'test',
        data: {},
        scheduledAt,
      });

      const before = Date.now();
      const runAt = await promise;

      const delay = runAt.getTime() - before;

      // Some drivers use a polling mechanism to fetch jobs, so we need to account for the latency of the polling mechanism
      expect(delay).to.be.approximately(0, processingLatencyMs + 2);
    });

    test('jobs are executed in the order of their schedule, regardless of the order they were scheduled in', async () => {
      const { driver } = await createDriver();
      const cadence = createCadence({ driver });

      const runOrder: { id: number; runAt: Date }[] = [];
      const { promise, resolve } = Promise.withResolvers<void>();

      cadence.registerTask({
        taskName: 'test',
        handler: async ({ data }) => {
          runOrder.push({ id: (data as any).id, runAt: new Date() });

          if (runOrder.length === 3) {
            resolve();
          }
        },
      });

      const now = new Date();

      await cadence.scheduleJob({
        taskName: 'test',
        data: { id: 1 },
        scheduledAt: new Date(now.getTime() + 20),
      });

      await cadence.scheduleJob({
        taskName: 'test',
        data: { id: 2 },
        scheduledAt: new Date(now.getTime() + 5),
      });

      await cadence.scheduleJob({
        taskName: 'test',
        data: { id: 3 },
        scheduledAt: new Date(now.getTime() + 10),
      });

      const worker = cadence.createWorker({ workerId: 'worker-1' });
      worker.start();

      await promise;

      expect(runOrder.map(({ id }) => id)).to.eql([2, 3, 1]);
    });
  });
};
