import type { Job, JobData, JobRepositoryDriver } from '../jobs/jobs.types';
import type { TaskDefinitionRegistry } from '../tasks/task-definition.registry';
import { createId } from '@paralleldrive/cuid2';
import { getNextExecutionDate } from '../shared/date';
import { validateTaskData } from '../tasks/tasks.usecases';

export async function scheduleJob({
  taskName,
  data,
  now = new Date(),
  scheduledAt = now,
  maxRetries,
  driver,
  taskRegistry,
  generateJobId = createId,
}: {
  taskName: string;
  data?: JobData;
  scheduledAt?: Date;
  now?: Date;
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
    createdAt: now,
  };

  await driver.saveJob({ job, now });

  return { jobId: job.id };
}

export async function schedulePeriodicJob({
  scheduleId: jobId,
  cron,
  taskName,
  data,
  now = new Date(),
  maxRetries,
  driver,
  taskRegistry,
  immediate = false,
}: {
  scheduleId: string;
  cron: string;
  taskName: string;
  data?: JobData;
  now?: Date;
  maxRetries?: number;
  driver: JobRepositoryDriver;
  taskRegistry?: TaskDefinitionRegistry;
  immediate?: boolean;
}) {
  const validatedData = await validateTaskData({ taskRegistry, taskName, data });
  const { nextDate } = getNextExecutionDate({ cron, relativeTo: now });

  const { job: existingJob } = await driver.getJob({ jobId });

  const job: Job = {
    id: jobId,
    taskName,
    data: validatedData as JobData,
    scheduledAt: immediate ? now : nextDate,
    status: 'pending',
    maxRetries,
    cron,
    createdAt: now,
  };

  if (existingJob) {
    await driver.updateJob({ jobId, values: job, now });
    return { jobId };
  }

  await driver.saveJob({ job, now });

  return { jobId };
}

export function createScheduler({ driver, taskRegistry, generateJobId }: { driver: JobRepositoryDriver; taskRegistry: TaskDefinitionRegistry; generateJobId?: () => string }) {
  return (args: Omit<Parameters<typeof scheduleJob>[0], 'driver' | 'taskRegistry' | 'generateJobId'>) => scheduleJob({ ...args, driver, taskRegistry, generateJobId });
}

export function createPeriodicJobScheduler({ driver, taskRegistry }: { driver: JobRepositoryDriver; taskRegistry: TaskDefinitionRegistry }) {
  return (args: Omit<Parameters<typeof schedulePeriodicJob>[0], 'driver' | 'taskRegistry'>) => schedulePeriodicJob({ ...args, driver, taskRegistry });
}
