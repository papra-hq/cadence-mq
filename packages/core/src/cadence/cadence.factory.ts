import type { JobRepositoryDriver } from '../jobs/jobs.types';
import type { TaskDefinitionRegistry } from '../tasks/task-definition.registry';
import { createPeriodicJobScheduler, createScheduler } from '../scheduler/scheduler';
import { createTaskRegistry } from '../tasks/task-definition.registry';
import { createWorkerFactory } from '../workers/workers.factory';

export type CadenceInstance = ReturnType<typeof createCadence>;

// The Cadence instance is a collection of functions that are used to interact with the Cadence system.
// It is used to conveniently register tasks, create workers, and schedule jobs
export function createCadence({
  driver,
  generateJobId,
  taskRegistry = createTaskRegistry(),
}: {
  driver: JobRepositoryDriver;
  generateJobId?: () => string;
  taskRegistry?: TaskDefinitionRegistry;
}) {
  return {
    createWorker: createWorkerFactory({ driver, taskRegistry }),
    scheduleJob: createScheduler({ driver, taskRegistry, generateJobId }),
    schedulePeriodicJob: createPeriodicJobScheduler({ driver, taskRegistry }),

    registerTask: taskRegistry.registerTask,
    getJob: driver.getJob,
    getJobCount: driver.getJobCount,
    deleteJob: driver.deleteJob,

    getTaskRegistry: () => taskRegistry,
    getDriver: () => driver,
  };
}
