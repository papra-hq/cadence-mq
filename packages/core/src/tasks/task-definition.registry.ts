import type { TaskDefinitionRegistry } from './task-definition.types';
import type { TaskDefinition } from './tasks.types';

export function createTaskDefinitionRegistry(): TaskDefinitionRegistry {
  const taskDefinitions = new Map<string, TaskDefinition>();

  return {
    saveTaskDefinition: ({ taskDefinition }: { taskDefinition: TaskDefinition }) => {
      if (taskDefinitions.has(taskDefinition.name)) {
        throw new Error(`Task definition already exists: ${taskDefinition.name}`);
      }

      taskDefinitions.set(taskDefinition.name, taskDefinition);
    },
    getTaskDefinitionOrThrow: ({ taskName }: { taskName: string }) => {
      const taskDefinition = taskDefinitions.get(taskName);

      if (!taskDefinition) {
        throw new Error(`Task definition not found: ${taskName}`);
      }

      return { taskDefinition };
    },
  };
}
