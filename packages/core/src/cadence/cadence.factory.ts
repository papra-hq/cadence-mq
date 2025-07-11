import type { JobRepositoryDriver } from '../jobs/jobs.types';
import { createScheduler } from '../scheduler/scheduler';
import { createTaskRegistry } from '../tasks/task-definition.registry';
import { createWorkerFactory } from '../workers/workers.factory';

export type CadenceInstance = ReturnType<typeof createCadence>;

// The Cadence instance is a collection of functions that are used to interact with the Cadence system.
// It is used to conveniently register tasks, create workers, and schedule jobs
export function createCadence({ driver, generateJobId }: { driver: JobRepositoryDriver; generateJobId?: () => string }) {
  const taskRegistry = createTaskRegistry();

  return {
    createWorker: createWorkerFactory({ driver, taskRegistry }),
    scheduleJob: createScheduler({ driver, taskRegistry, generateJobId }),

    registerTask: taskRegistry.registerTask,
    getJob: driver.getJob,
  };
}
