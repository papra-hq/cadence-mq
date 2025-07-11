import type { TestSuite } from '../types';
import { createCadence } from '@cadence-mq/core';
import { describe, expect, test } from 'vitest';
import { waitNextEventLoop } from '../utils';

export const testFailingJobs: TestSuite = ({ createDriver }) => {
  describe('failing jobs', () => {
    test('a job can fail, if no retries are specified, it is marked as failed and the error is saved', async () => {
      const { driver } = await createDriver();
      const cadence = createCadence({ driver, generateJobId: () => '123' });

      const { promise, resolve } = Promise.withResolvers<unknown>();

      cadence.registerTask({
        taskName: 'test',
        handler: async (args) => {
          try {
            throw new Error('An error occurred');
          } finally {
            resolve(args);
          }
        },
      });

      await cadence.scheduleJob({
        taskName: 'test',
        data: {
          foo: 'bar',
        },
      });

      const worker = cadence.createWorker({ workerId: 'worker-1' });
      worker.start();

      await promise;

      // wait for the job result to be saved to the database
      await new Promise(resolve => setImmediate(resolve));

      const { job } = await cadence.getJob({ jobId: '123' });

      expect(job?.status).to.eql('failed');

      // Testing only first lines as the stack trace is not deterministic
      const errorFirst3Lines = job?.error?.split('\n').slice(0, 3).join('\n');

      // The serialized error follow the node.js repl format where the first line is the error message
      // and the second line is the beginning of the stack trace repeating the error message
      expect(errorFirst3Lines).to.eql('An error occurred\n\nError: An error occurred');
    });

    test('when defining a task, you can specify the default number of retries for this task', async () => {
      const { driver } = await createDriver();
      const cadence = createCadence({ driver, generateJobId: () => '123' });

      let attempts = 0;

      cadence.registerTask({
        taskName: 'test',
        handler: async () => {
          attempts++;

          throw new Error('An error occurred');
        },
        options: {
          maxRetries: 2,
        },
      });

      await cadence.scheduleJob({
        taskName: 'test',
        data: {
          foo: 'bar',
        },
      });

      const worker = cadence.createWorker({ workerId: 'worker-1' });
      worker.start();

      await waitNextEventLoop();

      expect(attempts).to.eql(3);

      const { job } = await cadence.getJob({ jobId: '123' });

      expect(job?.status).to.eql('failed');
    });

    test('the amount of retry can be specified per job', async () => {
      const { driver } = await createDriver();
      const cadence = createCadence({ driver, generateJobId: () => '123' });

      let attempts = 0;

      cadence.registerTask({
        taskName: 'test',
        handler: async () => {
          attempts++;

          throw new Error('An error occurred');
        },
      });

      await cadence.scheduleJob({
        taskName: 'test',
        data: {
          foo: 'bar',
        },
        maxRetries: 2,
      });

      const worker = cadence.createWorker({ workerId: 'worker-1' });
      worker.start();

      await waitNextEventLoop();

      expect(attempts).to.eql(3);

      const { job } = await cadence.getJob({ jobId: '123' });

      expect(job?.status).to.eql('failed');
    });

    test('if both the task and the job specify the number of retries, the job takes precedence', async () => {
      const { driver } = await createDriver();
      const cadence = createCadence({ driver, generateJobId: () => '123' });

      let attempts = 0;
      cadence.registerTask({
        taskName: 'test',
        handler: async () => {
          attempts++;

          throw new Error('An error occurred');
        },
        options: {
          maxRetries: 2,
        },
      });

      await cadence.scheduleJob({
        taskName: 'test',
        data: {
          foo: 'bar',
        },
        maxRetries: 3,
      });

      const worker = cadence.createWorker({ workerId: 'worker-1' });
      worker.start();

      await waitNextEventLoop();

      expect(attempts).to.eql(4);

      const { job } = await cadence.getJob({ jobId: '123' });

      expect(job?.status).to.eql('failed');
    });
  });
};
