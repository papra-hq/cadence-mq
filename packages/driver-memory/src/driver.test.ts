import { createQueue } from '@cadence-mq/core';
import { runTestSuites } from '@cadence-mq/test-suites';
import { describe, expect, test } from 'vitest';
import { createMemoryDriver } from './driver';

describe('memory driver', () => {
  runTestSuites({
    createQueue: async (args = {}) => ({ queue: createQueue({ driver: createMemoryDriver(), ...args }) }),
  });

  describe('createMemoryDriver', () => {
    test('', async () => {
      const handlerArgs: unknown[] = [];
      const { promise, resolve } = Promise.withResolvers<void>();

      const queue = createQueue({
        driver: createMemoryDriver(),
      });

      queue.registerTask({
        name: 'test',
        handler: async (args) => {
          handlerArgs.push(args);
          resolve();
        },
      });

      queue.startWorker({ workerId: 'worker-1' });

      await queue.scheduleJob({
        taskName: 'test',
        data: {
          message: 'test',
        },
      });

      await promise;

      expect(handlerArgs).to.eql([{
        data: {
          message: 'test',
        },
        context: {
          workerId: 'worker-1',
        },
      }]);
    });

    test('multiple', async () => {
      const handlerArgs: unknown[] = [];
      let taskIndex = 0;
      const resolvers = [
        Promise.withResolvers<void>(),
        Promise.withResolvers<void>(),
      ];

      const queue = createQueue({
        driver: createMemoryDriver(),
      });

      queue.registerTask({
        name: 'test',
        handler: async (args) => {
          handlerArgs.push(args);
          resolvers[taskIndex++]?.resolve();
        },
      });

      queue.startWorker({ workerId: 'worker-1' });

      Promise.all([
        queue.scheduleJob({
          taskName: 'test',
          data: {
            message: 'test 1',
          },
        }),
        queue.scheduleJob({
          taskName: 'test',
          data: {
            message: 'test 2',
          },
        }),
      ]);

      await Promise.all(resolvers.map(resolver => resolver.promise));

      expect(handlerArgs).to.eql([
        {
          data: {
            message: 'test 1',
          },
          context: {
            workerId: 'worker-1',
          },
        },
        {
          data: {
            message: 'test 2',
          },
          context: {
            workerId: 'worker-1',
          },
        },
      ]);
    });
  });
});
