import type { TestSuite } from '../types';
import { createCadence } from '@cadence-mq/core';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

export const testPeriodicTasks: TestSuite = ({ createDriver }) => {
  describe('periodic tasks', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    test('a job can be defined to be repeated', async () => {
      const { driver } = await createDriver();

      const cadence = createCadence({ driver });

      const taskArgs: unknown[] = [];

      cadence.registerTask({
        taskName: 'test',
        handler: async (args) => {
          taskArgs.push(args);
        },
      });

      await cadence.schedulePeriodicJob({
        scheduleId: 'recurring-job',
        cron: '*/1 * * * *', // every minute
        taskName: 'test',
        data: { foo: 'bar' },
      });

      const worker = cadence.createWorker({ workerId: 'worker-1' });
      worker.start();

      await vi.advanceTimersByTimeAsync(1000 * 60 * 10); // 10 minutes

      expect(taskArgs.length).to.eql(10);
    });

    test('most of the time, scheduled jobs have no task data', async () => {
      const { driver } = await createDriver();

      const cadence = createCadence({ driver });

      const taskArgs: unknown[] = [];

      cadence.registerTask({
        taskName: 'test',
        handler: async (args) => {
          taskArgs.push(args);
        },
      });

      await cadence.schedulePeriodicJob({
        scheduleId: 'recurring-job',
        cron: '*/1 * * * *', // every minute
        taskName: 'test',
      });

      const worker = cadence.createWorker({ workerId: 'worker-1' });
      worker.start();

      await vi.advanceTimersByTimeAsync(1000 * 60 * 10); // 10 minutes

      expect(taskArgs.length).to.eql(10);
    });
  });
};
