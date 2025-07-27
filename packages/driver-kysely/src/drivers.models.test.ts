import { describe, expect, test } from 'vitest';
import { toJob } from './drivers.models';

describe('drivers models', () => {
  describe('toJob', () => {
    test('converts a database row to a job entity', () => {
      expect(
        toJob({
          id: '123',
          task_name: 'test',
          status: 'processing',
          scheduled_at: '2025-01-01T00:00:00.000Z',
          started_at: '2025-01-01T00:00:00.000Z',
          completed_at: undefined,
          max_retries: 3,
          data: '{"foo":"bar"}',
          result: undefined,
          error: undefined,
          cron: '0 0 * * *',
          created_at: '2025-01-01T00:00:00.000Z',
          delete_job_on_completion: 0,
        }),
      ).to.eql({
        id: '123',
        taskName: 'test',
        status: 'processing',
        scheduledAt: new Date('2025-01-01T00:00:00.000Z'),
        startedAt: new Date('2025-01-01T00:00:00.000Z'),
        completedAt: undefined,
        maxRetries: 3,
        data: { foo: 'bar' },
        result: undefined,
        error: undefined,
        cron: '0 0 * * *',
        createdAt: new Date('2025-01-01T00:00:00.000Z'),
        deleteJobOnCompletion: false,
      });
    });
  });
});
