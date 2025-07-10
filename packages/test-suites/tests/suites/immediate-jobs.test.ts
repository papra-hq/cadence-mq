import type { TestSuite } from '../types';
import { describe, expect, test } from 'vitest';
import { waitNextEventLoop } from '../utils';

export const testImmediateJobs: TestSuite = ({ createQueue }) => {
  describe('immediate jobs', () => {
    test('a job can be run immediately', async () => {
      const { queue } = await createQueue();

      const { promise, resolve } = Promise.withResolvers<unknown>();

      queue.registerTask({
        name: 'test',
        handler: async (args) => {
          resolve(args);
        },
      });

      queue.startWorker({ workerId: 'worker-1' });

      await queue.scheduleJob({
        taskName: 'test',
        data: {
          foo: 'bar',
        },
      });

      expect(await promise).to.eql({
        context: {
          workerId: 'worker-1',
        },
        data: {
          foo: 'bar',
        },
      });
    });

    test('when multiple jobs are immediately scheduled, they are run in the order they were scheduled', async () => {
      const { queue } = await createQueue();
      const runOrder: { id: number; runAt: Date }[] = [];

      queue.registerTask({
        name: 'test',
        handler: async ({ data }) => {
          runOrder.push({ id: (data as any).id, runAt: new Date() });
        },
      });

      await queue.scheduleJob({
        taskName: 'test',
        data: { id: 1 },
      });

      await queue.scheduleJob({
        taskName: 'test',
        data: { id: 2 },
      });

      await queue.scheduleJob({
        taskName: 'test',
        data: { id: 3 },
      });

      queue.startWorker({ workerId: 'worker-1' });

      await waitNextEventLoop();

      expect(runOrder.map(({ id }) => id)).to.eql([1, 2, 3]);
    });
  });
};
