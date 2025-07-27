import type { JobRepositoryDriver } from '../jobs/jobs.types';
import { describe, expect, test } from 'vitest';
import { createTaskRegistry } from '../tasks/task-definition.registry';
import { createScheduler, scheduleJob } from './scheduler';

describe('scheduler', () => {
  describe('scheduleJob', () => {
    test('scheduling a job validates the task data when a task registry is provided with the schema defined and persists the job using the provided driver', async () => {
      const driverSaveJobArgs: unknown[] = [];

      const driver = {
        saveJob: async (job) => {
          driverSaveJobArgs.push(job);
        },
      } as JobRepositoryDriver;

      const result = await scheduleJob({
        taskName: 'test-task-name',
        data: {
          test: 'test',
        },
        maxRetries: 0,

        driver,
        generateJobId: () => '123',
        now: new Date('2025-01-01'),
      });

      expect(driverSaveJobArgs).eql([{
        job: {
          id: '123',
          taskName: 'test-task-name',
          data: { test: 'test' },
          scheduledAt: new Date('2025-01-01'),
          createdAt: new Date('2025-01-01'),
          status: 'pending',
          maxRetries: 0,
          deleteJobOnCompletion: false,
        },
        now: new Date('2025-01-01'),
      }]);

      expect(result).eql({ jobId: '123' });
    });
  });

  describe('createScheduler', () => {
    test('higher order function that returns a scheduleJob function with their dependencies injected', async () => {
      const driverSaveJobArgs: unknown[] = [];

      const driver = {
        saveJob: async (job) => {
          driverSaveJobArgs.push(job);
        },
      } as JobRepositoryDriver;

      const taskRegistry = createTaskRegistry();

      const scheduleJob = createScheduler({ driver, taskRegistry, generateJobId: () => '123' });

      const result = await scheduleJob({
        taskName: 'test-task-name',
        data: { test: 'test' },
        now: new Date('2025-01-01'),
      });

      expect(driverSaveJobArgs).eql([{
        job: {
          id: '123',
          taskName: 'test-task-name',
          data: { test: 'test' },
          scheduledAt: new Date('2025-01-01'),
          createdAt: new Date('2025-01-01'),
          status: 'pending',
          maxRetries: undefined,
          deleteJobOnCompletion: false,
        },
        now: new Date('2025-01-01'),
      }]);

      expect(result).eql({ jobId: '123' });
    });
  });

  describe('schedulePeriodicJob', () => {
    test('', () => {

    });
  });
});
