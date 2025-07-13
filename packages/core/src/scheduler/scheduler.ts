import type { Job, JobData, JobRepositoryDriver } from '../jobs/jobs.types';
import type { TaskDefinitionRegistry } from '../tasks/task-definition.registry';
import { createId } from '@paralleldrive/cuid2';
import { validateTaskData } from '../tasks/tasks.usecases';

export async function scheduleJob({
  taskName,
  data,
  getNow = () => new Date(),
  scheduledAt = getNow(),
  maxRetries,
  driver,
  taskRegistry,
  generateJobId = createId,
}: {
  taskName: string;
  data: JobData;
  scheduledAt?: Date;
  getNow?: () => Date;
  maxRetries?: number;
  driver: JobRepositoryDriver;
  taskRegistry?: TaskDefinitionRegistry;
  generateJobId?: () => string;
}) {
  const validatedData = await validateTaskData({ taskRegistry, taskName, data });

  const job: Job = {
    id: generateJobId(),
    taskName,
    data: validatedData as JobData,
    scheduledAt,
    status: 'pending',
    maxRetries,
  };

  await driver.saveJob({ job, getNow });

  return { jobId: job.id };
}

export function createScheduler({ driver, taskRegistry, generateJobId, getNow }: { driver: JobRepositoryDriver; taskRegistry: TaskDefinitionRegistry; generateJobId?: () => string; getNow?: () => Date }) {
  return (args: Omit<Parameters<typeof scheduleJob>[0], 'driver' | 'taskRegistry' | 'generateJobId'>) => scheduleJob({ ...args, driver, taskRegistry, generateJobId, getNow });
}
