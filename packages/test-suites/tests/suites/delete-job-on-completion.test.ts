import type { TestSuite } from '../types';
import { createCadence } from '@cadence-mq/core';
import { describe, expect, test } from 'vitest';
import { waitNextEventLoop } from '../utils';

export const testDeleteJobOnCompletion: TestSuite = ({ createDriver }) => {
  describe('delete job on completion', () => {
    test('a job with deleteJobOnCompletion=true is automatically deleted when completed successfully', async () => {
      const { driver } = await createDriver();
      const cadence = createCadence({ driver });

      const { promise, resolve } = Promise.withResolvers<void>();

      cadence.registerTask({
        taskName: 'test',
        handler: async () => {
          resolve();
          return { success: true };
        },
      });

      // Schedule a job with deleteJobOnCompletion=true
      const { jobId } = await cadence.scheduleJob({
        taskName: 'test',
        data: { foo: 'bar' },
        deleteJobOnCompletion: true,
      });

      // Verify job exists initially
      expect(await cadence.getJobCount()).to.eql({ count: 1 });
      const { job } = await cadence.getJob({ jobId });
      expect(job?.deleteJobOnCompletion).toBe(true);

      const worker = cadence.createWorker({ workerId: 'worker-1' });
      worker.start();

      await promise;
      await waitNextEventLoop();

      // Verify job is automatically deleted after completion
      expect(await cadence.getJobCount()).to.eql({ count: 0 });
      const { job: deletedJob } = await cadence.getJob({ jobId });
      expect(deletedJob).toBeNull();
    });

    test('a job with deleteJobOnCompletion=false is not deleted when completed', async () => {
      const { driver } = await createDriver();
      const cadence = createCadence({ driver });

      const { promise, resolve } = Promise.withResolvers<void>();

      cadence.registerTask({
        taskName: 'test',
        handler: async () => {
          resolve();
          return { success: true };
        },
      });

      // Schedule a job with deleteJobOnCompletion=false
      const { jobId } = await cadence.scheduleJob({
        taskName: 'test',
        data: { foo: 'bar' },
        deleteJobOnCompletion: false,
      });

      // Verify job exists initially
      expect(await cadence.getJobCount()).to.eql({ count: 1 });
      const { job } = await cadence.getJob({ jobId });
      expect(job?.deleteJobOnCompletion).toBe(false);

      const worker = cadence.createWorker({ workerId: 'worker-1' });
      worker.start();

      await promise;
      await waitNextEventLoop();

      // Verify job is not deleted after completion
      expect(await cadence.getJobCount()).to.eql({ count: 1 });
      const { job: completedJob } = await cadence.getJob({ jobId });
      expect(completedJob?.status).toBe('completed');
    });

    test('a job without deleteJobOnCompletion is not deleted when completed successfully', async () => {
      const { driver } = await createDriver();
      const cadence = createCadence({ driver });

      const { promise, resolve } = Promise.withResolvers<void>();

      cadence.registerTask({
        taskName: 'test',
        handler: async () => {
          resolve();
          return { success: true };
        },
      });

      // Schedule a job without deleteJobOnCompletion
      const { jobId } = await cadence.scheduleJob({
        taskName: 'test',
        data: { foo: 'bar' },
      });

      // Verify job exists initially
      expect(await cadence.getJobCount()).to.eql({ count: 1 });
      const { job } = await cadence.getJob({ jobId });
      expect(job?.deleteJobOnCompletion).to.eql(false);

      const worker = cadence.createWorker({ workerId: 'worker-1' });
      worker.start();

      await promise;
      await waitNextEventLoop();

      // Verify job is not deleted after completion
      expect(await cadence.getJobCount()).to.eql({ count: 1 });
      const { job: completedJob } = await cadence.getJob({ jobId });
      expect(completedJob?.status).toBe('completed');
    });

    test('a job with deleteJobOnCompletion=true is not deleted when it fails', async () => {
      const { driver } = await createDriver();
      const cadence = createCadence({ driver });

      const { promise, resolve } = Promise.withResolvers<void>();

      cadence.registerTask({
        taskName: 'test',
        handler: async () => {
          resolve();
          throw new Error('Task failed');
        },
      });

      // Schedule a job with deleteJobOnCompletion=true
      const { jobId } = await cadence.scheduleJob({
        taskName: 'test',
        data: { foo: 'bar' },
        deleteJobOnCompletion: true,
      });

      const worker = cadence.createWorker({ workerId: 'worker-1' });
      worker.start();

      await promise;
      await waitNextEventLoop();

      // Verify job is not deleted when it fails
      expect(await cadence.getJobCount()).to.eql({ count: 1 });
      const { job: failedJob } = await cadence.getJob({ jobId });
      expect(failedJob?.status).toBe('failed');
    });

    test('a periodic job is not deleted when it completes, so the deleteJobOnCompletion flag is set to false', async () => {
      const { driver } = await createDriver();
      const cadence = createCadence({ driver });

      const { jobId } = await cadence.schedulePeriodicJob({
        scheduleId: 'periodic-job',
        cron: '*/1 * * * *',
        taskName: 'test',
        data: { foo: 'bar' },
      });

      expect(await cadence.getJobCount()).to.eql({ count: 1 });
      const { job } = await cadence.getJob({ jobId });
      expect(job?.deleteJobOnCompletion).to.eql(false);
    });
  });
};
