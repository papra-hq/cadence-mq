import type { TestSuite } from '../types';
import { createCadence } from '@cadence-mq/core';
import { describe, expect, test } from 'vitest';
import { waitNextEventLoop } from '../utils';

export const testJobCount: TestSuite = ({ createDriver }) => {
  describe('job count', () => {
    test('you can get the count of jobs, filtered by status', async () => {
      const { driver } = await createDriver();
      const cadence = createCadence({ driver });

      cadence.registerTask({ taskName: 'test', handler: async () => {} });

      expect(await cadence.getJobCount()).to.eql({ count: 0 });
      expect(await cadence.getJobCount({ filter: { status: 'pending' } })).to.eql({ count: 0 });
      expect(await cadence.getJobCount({ filter: { status: 'failed' } })).to.eql({ count: 0 });
      expect(await cadence.getJobCount({ filter: { status: 'processing' } })).to.eql({ count: 0 });
      expect(await cadence.getJobCount({ filter: { status: 'completed' } })).to.eql({ count: 0 });

      await cadence.scheduleJob({
        taskName: 'test',
        data: { foo: 'bar' },
      });

      expect(await cadence.getJobCount()).to.eql({ count: 1 });
      expect(await cadence.getJobCount({ filter: { status: 'pending' } })).to.eql({ count: 1 });
      expect(await cadence.getJobCount({ filter: { status: 'failed' } })).to.eql({ count: 0 });
      expect(await cadence.getJobCount({ filter: { status: 'processing' } })).to.eql({ count: 0 });
      expect(await cadence.getJobCount({ filter: { status: 'completed' } })).to.eql({ count: 0 });

      const worker = cadence.createWorker({ workerId: 'worker-1' });
      worker.start();

      await waitNextEventLoop();

      expect(await cadence.getJobCount()).to.eql({ count: 1 });
      expect(await cadence.getJobCount({ filter: { status: 'pending' } })).to.eql({ count: 0 });
      expect(await cadence.getJobCount({ filter: { status: 'failed' } })).to.eql({ count: 0 });
      expect(await cadence.getJobCount({ filter: { status: 'processing' } })).to.eql({ count: 0 });
      expect(await cadence.getJobCount({ filter: { status: 'completed' } })).to.eql({ count: 1 });
    });
  });
};
