import type { TestSuite } from '../types';
import { createCadence } from '@cadence-mq/core';
import { describe, expect, test } from 'vitest';
import { waitNextEventLoop } from '../utils';

export const testMultipleWorkers: TestSuite = ({ createDriver }) => {
  describe('multiple workers', () => {
    test('when multiple workers are running, a job is only run by one worker', async () => {
      const { driver } = await createDriver();
      const cadence = createCadence({ driver });

      const taskArgs: unknown[] = [];

      cadence.registerTask({
        taskName: 'test',
        handler: async (args) => {
          taskArgs.push(args);
        },
      });

      await cadence.scheduleJob({
        taskName: 'test',
        data: { foo: 'bar' },
      });

      const worker1 = cadence.createWorker({ workerId: 'worker-1' });
      const worker2 = cadence.createWorker({ workerId: 'worker-2' });

      worker1.start();
      worker2.start();

      await waitNextEventLoop();

      expect(taskArgs.length).to.eql(1);
    });
  });
};
