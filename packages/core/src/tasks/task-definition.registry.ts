import type { TaskDefinitionRegistry } from './task-definition.types';
import type { TaskDefinition } from './tasks.types';

export function createTaskDefinitionRegistry(): TaskDefinitionRegistry {
  const taskDefinitions = new Map<string, TaskDefinition>();

  return {
    add: (taskDefinition: TaskDefinition) => {
      if (taskDefinitions.has(taskDefinition.name)) {
        throw new Error(`Task definition already exists: ${taskDefinition.name}`);
      }

      taskDefinitions.set(taskDefinition.name, taskDefinition);
    },
    get: (name: string) => {
      const taskDefinition = taskDefinitions.get(name);

      if (!taskDefinition) {
        throw new Error(`Task definition not found: ${name}`);
      }

      return taskDefinition;
    },
  };
}
