import type { TestSuite } from '../types';
import { createCadence } from '@cadence-mq/core';
import { describe, expect, test } from 'vitest';
import { waitNextEventLoop } from '../utils';

export const testImmediateJobs: TestSuite = ({ createDriver }) => {
  describe('immediate jobs', () => {
    test('a job can be run immediately', async () => {
      const { driver } = await createDriver();
      const cadence = createCadence({ driver });

      const { promise, resolve } = Promise.withResolvers<unknown>();

      cadence.registerTask({
        taskName: 'test',
        handler: async (args) => {
          resolve(args);
        },
      });

      const worker = cadence.createWorker({ workerId: 'worker-1' });
      worker.start();

      await cadence.scheduleJob({
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
      const { driver } = await createDriver();
      const cadence = createCadence({ driver });
      const runOrder: { id: number; runAt: Date }[] = [];

      cadence.registerTask({
        taskName: 'test',
        handler: async ({ data }) => {
          runOrder.push({ id: (data as any).id, runAt: new Date() });
        },
      });

      await cadence.scheduleJob({
        taskName: 'test',
        data: { id: 1 },
      });

      await cadence.scheduleJob({
        taskName: 'test',
        data: { id: 2 },
      });

      await cadence.scheduleJob({
        taskName: 'test',
        data: { id: 3 },
      });

      const worker = cadence.createWorker({ workerId: 'worker-1' });
      worker.start();

      await waitNextEventLoop();

      expect(runOrder.map(({ id }) => id)).to.eql([1, 2, 3]);
    });
  });
};
