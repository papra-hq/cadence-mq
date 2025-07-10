import type { TestSuite } from '../types';
import { describe, expect, test } from 'vitest';
import { waitNextEventLoop } from '../utils';

export const testGettingJobs: TestSuite = ({ createQueue }) => {
  describe('getting jobs', () => {
    test('a job can be retrieved by it\'s id to get its status', async () => {
      const { queue } = await createQueue({ generateJobId: () => '123' });

      queue.registerTask({
        name: 'test',
        handler: async (args) => {
          return { biz: (args.data as any).foo };
        },
      });

      expect(await queue.getJob({ jobId: '123' })).to.eql({ job: null });

      const { jobId } = await queue.scheduleJob({
        taskName: 'test',
        data: {
          foo: 'bar',
        },
        scheduleAt: new Date('2025-01-01'),
      });

      expect(jobId).to.eql('123');

      expect(await queue.getJob({ jobId: '123' })).to.eql({
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

      queue.startWorker({ workerId: 'worker-1' });

      await waitNextEventLoop();

      const { job } = await queue.getJob({ jobId: '123' });

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
