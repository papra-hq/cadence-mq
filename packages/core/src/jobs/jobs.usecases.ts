import type { TaskContext, TaskDefinition } from '../tasks/tasks.types';
import type { Job } from './jobs.types';
import { retry } from '../shared/retry';

export async function processJob({ job, taskDefinition, taskExecutionContext }: { job: Job; taskDefinition: TaskDefinition; taskExecutionContext: TaskContext }) {
  const maxRetries = job.maxRetries ?? taskDefinition.options?.maxRetries ?? 0;

  return await retry(
    () => taskDefinition.handler({ data: job.data, context: taskExecutionContext }),
    { maxRetries },
  );
}
