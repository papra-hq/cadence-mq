import type { TaskContext, TaskDefinition } from '../tasks/tasks.types';
import type { Job } from './jobs.types';
import { describe, expect, test } from 'vitest';
import { processJob } from './jobs.usecases';

describe('jobs usecases', () => {
  describe('processJob', () => {
    const taskExecutionContext: TaskContext = {
      workerId: 'test-worker-id',
    };

    const job: Job = {
      id: 'test-job-id',
      taskName: 'test-task-name',
      status: 'pending',
      data: {
        test: 'test',
      },
      scheduleAt: new Date('2025-01-01'),
    };

    test('execute the task handler for a job, providing the job data and the task execution context and returning the handler result', async () => {
      const handlerArgs: unknown[] = [];

      const result = await processJob({
        job,
        taskExecutionContext,
        taskDefinition: {
          taskName: 'test-task-name',
          handler: async (args) => {
            handlerArgs.push(args);

            return {
              foo: 'bar',
            };
          },
        },
      });

      expect(handlerArgs).eql([{
        data: { test: 'test' },
        context: taskExecutionContext,
      }]);

      expect(result).eql({ foo: 'bar' });
    });

    test('if the task fails, by default the error is thrown', async () => {
      const taskDefinition: TaskDefinition = {
        taskName: 'test-task-name',
        handler: async () => {
          throw new Error('test');
        },
      };

      await expect(processJob({ job, taskDefinition, taskExecutionContext })).rejects.toThrow('test');
    });

    test('a retry can be configured on the task definition, and the job will be retried up to the configured number of times', async () => {
      let attempts = 0;

      const taskDefinition: TaskDefinition = {
        taskName: 'test-task-name',
        handler: async () => {
          attempts++;
          throw new Error('test');
        },
        options: {
          maxRetries: 2,
        },
      };

      await expect(processJob({ job, taskDefinition, taskExecutionContext })).rejects.toThrow('test');

      expect(attempts).eql(3);
    });

    test('the retry count can be configured per job', async () => {
      let attempts = 0;
      const taskDefinition: TaskDefinition = {
        taskName: 'test-task-name',
        handler: async () => {
          attempts++;
          throw new Error('test');
        },
      };

      await expect(processJob({ job: { ...job, maxRetries: 1 }, taskDefinition, taskExecutionContext })).rejects.toThrow('test');

      expect(attempts).eql(2);
    });

    test('when both the task definition and the job have a retry count configured, the job retry count takes precedence', async () => {
      let attempts = 0;
      const taskDefinition: TaskDefinition = {
        taskName: 'test-task-name',
        handler: async () => {
          attempts++;
          throw new Error('test');
        },
        options: {
          maxRetries: 2,
        },
      };

      await expect(processJob({ job: { ...job, maxRetries: 1 }, taskDefinition, taskExecutionContext })).rejects.toThrow('test');

      expect(attempts).eql(2);
    });
  });
});
