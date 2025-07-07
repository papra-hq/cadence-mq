import type { Job, JobData, JobRepositoryDriver } from './jobs/jobs.types';
import type { TaskDefinition } from './tasks/tasks.types';
import { customAlphabet } from 'nanoid';
import { serializeError } from './errors/errors.models';
import { processJob } from './jobs/jobs.usecases';
import { createTaskDefinitionRegistry } from './tasks/task-definition.registry';

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

  return {
    registerTask: (taskDefinition: TaskDefinition) => {
      taskDefinitionRegistry.add(taskDefinition);
    },

    async scheduleJob({
      taskName,
      data,
      now = new Date(),
      scheduleAt = now,
      maxRetries,
    }: {
      taskName: string;
      data: JobData;
      scheduleAt?: Date;
      now?: Date;
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

      await driver.saveJob({ job, now });
    },

    startWorker({ workerId: _ }: { workerId: string }) {
      status = 'running';

      (async () => {
      // eslint-disable-next-line no-unmodified-loop-condition
        while (status === 'running') {
          const { job } = await driver.fetchNextJob({ processingTimeoutMs });

          if (!job) {
            await new Promise(resolve => setTimeout(resolve, 1000));
            continue;
          }

          const jobId = job.id;

          try {
            const result = await processJob({ job, taskDefinitionRegistry });
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

    stopWorker(): Promise<void> {
      const { promise, resolve } = Promise.withResolvers<void>();
      stopPromiseResolver = resolve;
      status = 'stopping';

      return promise;
    },
  };
}
