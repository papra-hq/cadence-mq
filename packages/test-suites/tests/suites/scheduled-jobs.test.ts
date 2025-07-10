import type { TestSuite } from '../types';
import { describe, expect, test } from 'vitest';

export const testScheduledJobs: TestSuite = ({ createQueue, processingLatencyMs = 0 }) => {
  describe('scheduled jobs', () => {
    test('a job can be scheduled in the future', async () => {
      const { queue } = await createQueue();

      const scheduledAt = new Date(Date.now() + 50);
      const { promise, resolve } = Promise.withResolvers<Date>();

      queue.registerTask({
        name: 'test',
        handler: async () => {
          resolve(new Date());
        },
      });

      queue.startWorker({ workerId: 'worker-1' });

      await queue.scheduleJob({
        taskName: 'test',
        data: {},
        scheduleAt: scheduledAt,
      });

      const runAt = await promise;

      expect(runAt.getTime()).toBeGreaterThanOrEqual(scheduledAt.getTime());
    });

    test('a job scheduled in the past is run immediately', async () => {
      const { queue } = await createQueue();

      const scheduledAt = new Date(Date.now() - 1000 * 60);
      const { promise, resolve } = Promise.withResolvers<Date>();

      queue.registerTask({
        name: 'test',
        handler: async () => {
          resolve(new Date());
        },
      });

      queue.startWorker({ workerId: 'worker-1' });

      await queue.scheduleJob({
        taskName: 'test',
        data: {},
        scheduleAt: scheduledAt,
      });

      const before = Date.now();
      const runAt = await promise;

      const delay = runAt.getTime() - before;

      // Some drivers use a polling mechanism to fetch jobs, so we need to account for the latency of the polling mechanism
      expect(delay).to.be.approximately(0, processingLatencyMs + 2);
    });

    test('jobs are executed in the order of their schedule, regardless of the order they were scheduled in', async () => {
      const { queue } = await createQueue();

      const runOrder: { id: number; runAt: Date }[] = [];
      const { promise, resolve } = Promise.withResolvers<void>();

      queue.registerTask({
        name: 'test',
        handler: async ({ data }) => {
          runOrder.push({ id: (data as any).id, runAt: new Date() });

          if (runOrder.length === 3) {
            resolve();
          }
        },
      });

      const now = new Date();

      await queue.scheduleJob({
        taskName: 'test',
        data: { id: 1 },
        scheduleAt: new Date(now.getTime() + 20),
      });

      await queue.scheduleJob({
        taskName: 'test',
        data: { id: 2 },
        scheduleAt: new Date(now.getTime() + 5),
      });

      await queue.scheduleJob({
        taskName: 'test',
        data: { id: 3 },
        scheduleAt: new Date(now.getTime() + 10),
      });

      queue.startWorker({ workerId: 'worker-1' });

      await promise;

      expect(runOrder.map(({ id }) => id)).to.eql([2, 3, 1]);
    });
  });
};
