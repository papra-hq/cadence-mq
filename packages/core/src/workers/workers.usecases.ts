import type { JobRepositoryDriver } from '../jobs/jobs.types';
import type { CadenceLogger } from '../logger/logger.types';
import type { TaskDefinitionRegistry } from '../tasks/task-definition.registry';
import type { WorkerEventEmitter } from './workers.types';
import { createJobNotFoundError } from '../errors/errors.definitions';
import { safely, serializeError } from '../errors/errors.models';
import { processJob } from '../jobs/jobs.usecases';
import { getNextExecutionDate } from '../shared/date';
import { createTaskExecutionContext } from '../tasks/tasks.models';

async function consumeJob({
  driver,
  taskRegistry,
  workerId,
  abortSignal,
  now,
  eventEmitter,
  throwOnTaskNotFound = false,
  logger,
}: {
  driver: JobRepositoryDriver;
  taskRegistry: TaskDefinitionRegistry;
  workerId: string;
  abortSignal: AbortSignal;
  now?: Date;
  eventEmitter: WorkerEventEmitter;
  throwOnTaskNotFound?: boolean;
  logger?: Partial<CadenceLogger>;
}) {
  const { job } = await driver.getNextJobAndMarkAsProcessing({ abortSignal, now });
  const { id: jobId, taskName } = job;

  logger?.debug?.({ jobId, taskName }, 'Consuming job');

  const { taskDefinition } = taskRegistry.getTask({ taskName });

  if (!taskDefinition && throwOnTaskNotFound) {
    throw createJobNotFoundError();
  }

  if (!taskDefinition) {
    eventEmitter.emit('task.not-found', { taskName });
    return;
  }

  const { taskExecutionContext } = createTaskExecutionContext({ workerId });

  eventEmitter.emit('job.started', { jobId });
  const [error, result] = await safely(processJob({ job, taskDefinition, taskExecutionContext }));

  if (job.cron) {
    const { nextDate } = getNextExecutionDate({ cron: job.cron, relativeTo: job.scheduledAt });
    await driver.updateJob({ jobId, values: {
      scheduledAt: nextDate,
      status: 'pending',
      error: error ? serializeError({ error }) : undefined,
      completedAt: now,
    } });

    eventEmitter.emit('job.rescheduled', { jobId, nextDate, error });
    logger?.info?.({ jobId, taskName, nextDate }, 'Job rescheduled');
    return;
  }

  if (error) {
    await driver.updateJob({ jobId, values: { error: serializeError({ error }), status: 'failed', completedAt: now }, now });
    eventEmitter.emit('job.failed', { jobId, error });
    logger?.error?.({ jobId, taskName, error }, 'Job failed');
    return;
  }

  await driver.updateJob({ jobId, values: { result, status: 'completed', completedAt: now }, now });
  eventEmitter.emit('job.completed', { jobId, result });
  logger?.info?.({ jobId, taskName }, 'Job completed');

  if (job.deleteJobOnCompletion && !job.cron) {
    await driver.deleteJob({ jobId });
    eventEmitter.emit('job.deleted', { jobId });
    logger?.info?.({ jobId, taskName }, 'Job deleted');
  }
}

export function startConsumingJobs({
  driver,
  taskRegistry,
  workerId,
  abortSignal,
  getNow,
  eventEmitter,
  logger,
}: {
  driver: JobRepositoryDriver;
  taskRegistry: TaskDefinitionRegistry;
  workerId: string;
  abortSignal: AbortSignal;
  getNow?: () => Date;
  eventEmitter: WorkerEventEmitter;
  logger?: Partial<CadenceLogger>;
}) {
  setImmediate(async () => {
    while (true) {
      await consumeJob({ driver, taskRegistry, workerId, abortSignal, now: getNow?.(), eventEmitter, logger });
    }
  });
}
