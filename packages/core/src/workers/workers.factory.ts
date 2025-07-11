import type { JobRepositoryDriver } from '../jobs/jobs.types';
import type { TaskDefinitionRegistry } from '../tasks/task-definition.registry';
import type { WorkerEvents } from './workers.types';
import { createEventEmitter } from '../events/event-emitter';
import { startConsumingJobs } from './workers.usecases';

export function createWorker({
  driver,
  taskRegistry,
  workerId,
  getNow = () => new Date(),
}: {
  driver: JobRepositoryDriver;
  taskRegistry: TaskDefinitionRegistry;
  workerId: string;
  getNow?: () => Date;
}) {
  let status: 'running' | 'stopped' | 'stopping' | 'paused' = 'stopped';
  const abortController = new AbortController();
  const eventEmitter = createEventEmitter<WorkerEvents>();

  return {
    start: () => {
      status = 'running';

      startConsumingJobs({
        driver,
        taskRegistry,
        workerId,
        abortSignal: abortController.signal,
        getNow,
        eventEmitter,
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
}) {
  return (instanceArgs: { workerId: string; getNow?: () => Date }) => createWorker({ ...factoryArgs, ...instanceArgs });
}
