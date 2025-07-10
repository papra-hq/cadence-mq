import type { Job, JobData, JobRepositoryDriver } from './jobs/jobs.types';
import type { TaskDefinition } from './tasks/tasks.types';
import { customAlphabet } from 'nanoid';
import { serializeError } from './errors/errors.models';
import { processJob } from './jobs/jobs.usecases';
import { createTaskDefinitionRegistry } from './tasks/task-definition.registry';
import { createTaskExecutionContext } from './tasks/tasks.models';

export type Queue = ReturnType<typeof createQueue>;

export function createQueue({
  driver,
  processingTimeoutMs = 10000,
  generateJobId = customAlphabet('1234567890abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ', 32),
}: {
  driver: JobRepositoryDriver;
  processingTimeoutMs?: number;
  generateJobId?: () => string;
}) {
  const taskDefinitionRegistry = createTaskDefinitionRegistry();
  let status: 'running' | 'stopped' | 'stopping' = 'stopped';
  let stopPromiseResolver: (() => void) | null = null;
  let abortController: AbortController | null = null;

  return {
    registerTask: (taskDefinition: TaskDefinition) => {
      taskDefinitionRegistry.saveTaskDefinition({ taskDefinition });
    },

    async scheduleJob({
      taskName,
      data,
      getNow = () => new Date(),
      scheduleAt = getNow(),
      maxRetries,
    }: {
      taskName: string;
      data: JobData;
      scheduleAt?: Date;
      getNow?: () => Date;
      maxRetries?: number;
    }) {
      const job: Job = {
        id: generateJobId(),
        taskName,
        data,
        scheduleAt,
        status: 'pending',
        maxRetries,
      };

      await driver.saveJob({ job, getNow });

      return { jobId: job.id };
    },

    async getJob({ jobId }: { jobId: string }) {
      const { job } = await driver.getJob({ jobId });

      return { job };
    },

    startWorker({ workerId }: { workerId: string }) {
      if (status === 'running') {
        throw new Error('Worker already running');
      }

      status = 'running';
      abortController = new AbortController();

      (async () => {
      // eslint-disable-next-line no-unmodified-loop-condition
        while (status === 'running') {
          const { job } = await driver.fetchNextJob({ processingTimeoutMs, abortSignal: abortController.signal });
          const { id: jobId, taskName } = job;

          const { taskDefinition } = taskDefinitionRegistry.getTaskDefinitionOrThrow({ taskName });
          const { taskExecutionContext } = createTaskExecutionContext({ workerId });

          try {
            const result = await processJob({ job, taskDefinition, taskExecutionContext });
            await driver.markJobAsCompleted({ jobId, result: result ?? undefined });
          } catch (error) {
            await driver.markJobAsFailed({ jobId, error: serializeError({ error }) });
          }
        }

        status = 'stopped';
        stopPromiseResolver?.();
        stopPromiseResolver = null;
      })();
    },

    async stopWorker(): Promise<void> {
      const { promise, resolve } = Promise.withResolvers<void>();
      stopPromiseResolver = resolve;
      status = 'stopping';
      abortController?.abort();

      await promise;
    },
  };
}
