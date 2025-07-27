import type { TestSuite } from '../types';
import { createCadence } from '@cadence-mq/core';
import { describe, expect, test } from 'vitest';
import { waitNextEventLoop } from '../utils';

export const testDeleteJobs: TestSuite = ({ createDriver }) => {
  describe('delete jobs', () => {
    test('a job can be deleted by its id', async () => {
      const { driver } = await createDriver();
      const cadence = createCadence({ driver, generateJobId: () => 'job-1' });

      cadence.registerTask({
        taskName: 'test',
        handler: async () => {},
      });

      // Initially no jobs
      expect(await cadence.getJobCount()).to.eql({ count: 0 });

      // Schedule a job
      const { jobId } = await cadence.scheduleJob({
        taskName: 'test',
        data: { foo: 'bar' },
      });
      expect(jobId).to.eql('job-1');

      // Verify job exists
      expect(await cadence.getJobCount()).to.eql({ count: 1 });
      const { job } = await cadence.getJob({ jobId: 'job-1' });
      expect(job?.id).to.eql('job-1');

      // Delete the job
      await cadence.deleteJob({ jobId: 'job-1' });

      // Verify job is deleted
      expect(await cadence.getJobCount()).to.eql({ count: 0 });
      const { job: deletedJob } = await cadence.getJob({ jobId: 'job-1' });
      expect(deletedJob).toBeNull();
    });

    test('deleting a non-existent job throws an error', async () => {
      const { driver } = await createDriver();
      const cadence = createCadence({ driver });

      await expect(cadence.deleteJob({ jobId: 'non-existent' })).rejects.toThrow('Job not found');
    });

    test('a completed job can be deleted', async () => {
      const { driver } = await createDriver();
      const cadence = createCadence({ driver, generateJobId: () => 'job-1' });

      const { promise, resolve } = Promise.withResolvers<void>();

      cadence.registerTask({
        taskName: 'test',
        handler: async () => {
          resolve();
        },
      });

      await cadence.scheduleJob({
        taskName: 'test',
        data: { foo: 'bar' },
      });

      const worker = cadence.createWorker({ workerId: 'worker-1' });
      worker.start();

      await promise;
      await waitNextEventLoop();

      // Verify job is completed
      const { job } = await cadence.getJob({ jobId: 'job-1' });
      expect(job?.status).to.eql('completed');

      // Delete the completed job
      await cadence.deleteJob({ jobId: 'job-1' });

      // Verify job is deleted
      expect(await cadence.getJobCount()).to.eql({ count: 0 });
      const { job: deletedJob } = await cadence.getJob({ jobId: 'job-1' });
      expect(deletedJob).toBeNull();
    });

    test('a failed job can be deleted', async () => {
      const { driver } = await createDriver();
      const cadence = createCadence({ driver, generateJobId: () => 'job-1' });

      const { promise, resolve } = Promise.withResolvers<void>();

      cadence.registerTask({
        taskName: 'test',
        handler: async () => {
          resolve();
          throw new Error('Task failed');
        },
      });

      await cadence.scheduleJob({
        taskName: 'test',
        data: { foo: 'bar' },
      });

      const worker = cadence.createWorker({ workerId: 'worker-1' });
      worker.start();

      await promise;
      await waitNextEventLoop();

      // Verify job is failed
      const { job } = await cadence.getJob({ jobId: 'job-1' });
      expect(job?.status).to.eql('failed');

      // Delete the failed job
      await cadence.deleteJob({ jobId: 'job-1' });

      // Verify job is deleted
      expect(await cadence.getJobCount()).to.eql({ count: 0 });
      const { job: deletedJob } = await cadence.getJob({ jobId: 'job-1' });
      expect(deletedJob).toBeNull();
    });
  });
};
