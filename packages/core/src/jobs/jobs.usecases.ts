import type { TaskDefinitionRegistry } from '../tasks/task-definition.types';
import type { Job } from './jobs.types';
import { retry } from '../shared/retry';

export async function processJob({ job, taskDefinitionRegistry }: { job: Job; taskDefinitionRegistry: TaskDefinitionRegistry }) {
  const taskDefinition = taskDefinitionRegistry.get(job.taskName);

  const maxRetries = job.maxRetries ?? taskDefinition.options?.maxRetries ?? 0;

  return await retry(
    () => taskDefinition.handler({ data: job.data, context: { workerId: job.id } }),
    { maxRetries },
  );
}
