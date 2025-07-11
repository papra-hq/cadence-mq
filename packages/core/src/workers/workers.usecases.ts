import type { JobRepositoryDriver } from '../jobs/jobs.types';
import type { TaskDefinitionRegistry } from '../tasks/task-definition.registry';
import type { WorkerEventEmitter } from './workers.types';
import { safely, serializeError } from '../errors/errors.models';
import { processJob } from '../jobs/jobs.usecases';
import { createTaskExecutionContext } from '../tasks/tasks.models';

export async function consumeJob({
  driver,
  taskRegistry,
  workerId,
  abortSignal,
  getNow,
  eventEmitter,
}: {
  driver: JobRepositoryDriver;
  taskRegistry: TaskDefinitionRegistry;
  workerId: string;
  abortSignal: AbortSignal;
  getNow?: () => Date;
  eventEmitter: WorkerEventEmitter;
}) {
  const { job } = await driver.getNextJobAndMarkAsProcessing({ abortSignal, getNow });
  const { id: jobId, taskName } = job;

  const { taskDefinition } = taskRegistry.getTaskOrThrow({ taskName });
  const { taskExecutionContext } = createTaskExecutionContext({ workerId });

  eventEmitter.emit('job.started', { jobId });
  const [error, result] = await safely(processJob({ job, taskDefinition, taskExecutionContext }));

  if (error) {
    await driver.markJobAsFailed({ jobId, error: serializeError({ error }) });
    eventEmitter.emit('job.failed', { jobId, error });
    return;
  }

  await driver.markJobAsCompleted({ jobId, result, getNow });
  eventEmitter.emit('job.completed', { jobId, result });
}

export function startConsumingJobs({
  driver,
  taskRegistry,
  workerId,
  abortSignal,
  getNow,
  eventEmitter,
}: {
  driver: JobRepositoryDriver;
  taskRegistry: TaskDefinitionRegistry;
  workerId: string;
  abortSignal: AbortSignal;
  getNow?: () => Date;
  eventEmitter: WorkerEventEmitter;
}) {
  setImmediate(async () => {
    while (true) {
      await consumeJob({ driver, taskRegistry, workerId, abortSignal, getNow, eventEmitter });
    }
  });
}
