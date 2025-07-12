import type { TaskDefinitionRegistry } from './task-definition.registry';
import type { TaskDefinition } from './tasks.types';

export async function validateTaskDefinitionData({ taskDefinition, data }: { taskDefinition: TaskDefinition; data: unknown }) {
  const schema = taskDefinition.schema?.data;

  if (!schema) {
    return data;
  }

  const result = await schema['~standard'].validate(data);

  if (result?.issues) {
    throw new Error(`Invalid data for task ${taskDefinition.taskName}: ${JSON.stringify(result.issues.map(issue => issue.message).join(', '))}`);
  }

  return result?.value;
}

export async function validateTaskData({ taskRegistry, taskName, data }: { taskRegistry?: TaskDefinitionRegistry; taskName: string; data: unknown }) {
  if (!taskRegistry) {
    return data;
  }

  const { taskDefinition } = taskRegistry.getTask({ taskName });

  if (!taskDefinition) {
    return data;
  }

  return await validateTaskDefinitionData({ taskDefinition, data });
}
