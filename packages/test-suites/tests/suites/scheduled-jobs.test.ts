import type { TestSuite } from '../types';
import { createCadence } from '@cadence-mq/core';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

export const testScheduledJobs: TestSuite = ({ createDriver, processingLatencyMs = 0 }) => {
  describe('scheduled jobs', () => {
    beforeEach(async () => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    test('a job can be scheduled in the future', async () => {
      const { driver } = await createDriver();
      const cadence = createCadence({ driver });
      const tasksInvocations: { at: Date }[] = [];

      cadence.registerTask({
        taskName: 'test',
        handler: async () => {
          tasksInvocations.push({ at: new Date() });
        },
      });

      const worker = cadence.createWorker({ workerId: 'worker-1' });
      worker.start();

      const scheduledAt = new Date(Date.now() + 1_000 * 60 * 10); // 10 minutes from now

      await cadence.scheduleJob({
        taskName: 'test',
        data: {},
        scheduledAt,
      });

      await vi.advanceTimersByTimeAsync(1_000 * 60 * 9); // 9 minutes from now
      expect(tasksInvocations.length).to.eql(0);

      await vi.advanceTimersByTimeAsync(1_000 * 60 * 1); // 1 minute from now

      expect(tasksInvocations.length).to.eql(1);
    });

    test('a job scheduled in the past is run immediately', async () => {
      const { driver } = await createDriver();
      const cadence = createCadence({ driver });

      const scheduledAt = new Date(Date.now() - 1000 * 60);
      const tasksInvocations: { at: Date }[] = [];

      cadence.registerTask({
        taskName: 'test',
        handler: async () => {
          tasksInvocations.push({ at: new Date() });
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

      await vi.advanceTimersByTimeAsync(processingLatencyMs);

      expect(tasksInvocations.length).to.eql(1);

      const delay = tasksInvocations[0]!.at.getTime() - before;

      expect(delay).to.be.approximately(0, processingLatencyMs + 2);
    });

    test('jobs are executed in the order of their schedule, regardless of the order they were scheduled in', async () => {
      const { driver } = await createDriver();
      const cadence = createCadence({ driver });

      const runOrder: { id: number; runAt: Date }[] = [];

      cadence.registerTask({
        taskName: 'test',
        handler: async ({ data }) => {
          runOrder.push({ id: (data as any).id, runAt: new Date() });
        },
      });

      const now = new Date();

      await cadence.scheduleJob({
        taskName: 'test',
        data: { id: 1 },
        scheduledAt: new Date(now.getTime() + 200),
      });

      await cadence.scheduleJob({
        taskName: 'test',
        data: { id: 2 },
        scheduledAt: new Date(now.getTime() + 50),
      });

      await cadence.scheduleJob({
        taskName: 'test',
        data: { id: 3 },
        scheduledAt: new Date(now.getTime() + 100),
      });

      const worker = cadence.createWorker({ workerId: 'worker-1' });
      worker.start();

      await vi.advanceTimersByTimeAsync(200 + processingLatencyMs); // 200ms from now

      expect(runOrder.map(({ id }) => id)).to.eql([2, 3, 1]);
    });
  });
};
