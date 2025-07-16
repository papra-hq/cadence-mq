import type { TestSuite } from '../types';
import { createCadence } from '@cadence-mq/core';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

export const testHangingJobs: TestSuite = ({ createDriver }) => {
  describe('hanging jobs', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    test('when a job is stuck in the processing state for too long (maybe due to a a worker crashing mid-execution), it should be re processed by a new worker after a timeout', async () => {
      const { driver } = await createDriver();

      const cadence = createCadence({ driver });

      const taskArgs: unknown[] = [];

      cadence.registerTask({
        taskName: 'test',
        handler: async (args) => {
          taskArgs.push(args);
        },
      });

      await driver.saveJob({
        job: {
          id: 'job-1',
          taskName: 'test',
          status: 'processing',
          scheduledAt: new Date(),
          startedAt: new Date(),
        },
      });

      const worker = cadence.createWorker({ workerId: 'worker-1' });
      worker.start();

      await vi.advanceTimersByTimeAsync(1000 * 60 * 5); // 5 minutes

      // after 5 minutes, the job should still be in the processing state
      expect((await cadence.getJob({ jobId: 'job-1' })).job).to.include({ status: 'processing' });

      await vi.advanceTimersByTimeAsync(1000 * 60 * 10); // 10 minutes

      // after 10 minutes, the job should be completed
      expect((await cadence.getJob({ jobId: 'job-1' })).job).to.include({ status: 'completed' });
    });
  });
};
