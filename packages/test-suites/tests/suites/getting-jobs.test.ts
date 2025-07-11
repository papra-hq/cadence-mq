import type { TestSuite } from '../types';
import { createCadence } from '@cadence-mq/core';
import { describe, expect, test } from 'vitest';
import { waitNextEventLoop } from '../utils';

export const testGettingJobs: TestSuite = ({ createDriver }) => {
  describe('getting jobs', () => {
    test('a job can be retrieved by it\'s id to get its status', async () => {
      const { driver } = await createDriver();
      const cadence = createCadence({ driver, generateJobId: () => '123' });

      cadence.registerTask({
        taskName: 'test',
        handler: async (args) => {
          return { biz: (args.data as any).foo };
        },
      });

      expect(await cadence.getJob({ jobId: '123' })).to.eql({ job: null });

      const { jobId } = await cadence.scheduleJob({
        taskName: 'test',
        data: {
          foo: 'bar',
        },
        scheduleAt: new Date('2025-01-01'),
      });

      expect(jobId).to.eql('123');

      expect(await cadence.getJob({ jobId: '123' })).to.eql({
        job: {
          id: '123',
          taskName: 'test',
          status: 'pending',
          data: {
            foo: 'bar',
          },
          error: undefined,
          completedAt: undefined,
          scheduleAt: new Date('2025-01-01'),
          startedAt: undefined,
          maxRetries: undefined,
          result: undefined,
        },
      });

      const worker = cadence.createWorker({ workerId: 'worker-1' });
      worker.start();

      await waitNextEventLoop();

      const { job } = await cadence.getJob({ jobId: '123' });

      expect(job).to.deep.include({
        id: '123',
        taskName: 'test',
        status: 'completed',
        data: {
          foo: 'bar',
        },
        scheduleAt: new Date('2025-01-01'),
        maxRetries: undefined,
        result: {
          biz: 'bar',
        },
      });

      expect(job?.completedAt).to.be.instanceOf(Date);
      expect(job?.startedAt).to.be.instanceOf(Date);

      expect(job?.completedAt).to.be.greaterThanOrEqual(job!.startedAt!);
    });
  });
};
