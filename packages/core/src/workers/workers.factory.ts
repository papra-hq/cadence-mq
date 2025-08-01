import type { JobRepositoryDriver } from '../jobs/jobs.types';
import type { CadenceLogger } from '../logger/logger.types';
import type { TaskDefinitionRegistry } from '../tasks/task-definition.registry';
import type { WorkerEvents } from './workers.types';
import { createEventEmitter } from '../events/event-emitter';
import { startConsumingJobs } from './workers.usecases';

export function createWorker({
  driver,
  taskRegistry,
  workerId,
  getNow = () => new Date(),
  logger,
}: {
  driver: JobRepositoryDriver;
  taskRegistry: TaskDefinitionRegistry;
  workerId: string;
  getNow?: () => Date;
  logger?: Partial<CadenceLogger>;
}) {
  let status: 'running' | 'stopped' | 'stopping' | 'paused' = 'stopped';
  const abortController = new AbortController();
  const eventEmitter = createEventEmitter<WorkerEvents>();

  return {
    start: () => {
      status = 'running';
      logger?.info?.({ workerId }, 'Worker started');

      startConsumingJobs({
        driver,
        taskRegistry,
        workerId,
        abortSignal: abortController.signal,
        getNow,
        eventEmitter,
        logger,
      });
    },
    getStatus: () => status,
    on: eventEmitter.on,
  };
}

export function createWorkerFactory(factoryArgs: {
  driver: JobRepositoryDriver;
  taskRegistry: TaskDefinitionRegistry;
  getNow?: () => Date;
  logger?: Partial<CadenceLogger>;
}) {
  return (instanceArgs: { workerId: string; getNow?: () => Date; logger?: Partial<CadenceLogger> }) => createWorker({ ...factoryArgs, ...instanceArgs });
}
