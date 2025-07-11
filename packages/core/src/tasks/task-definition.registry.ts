import type { StandardSchemaV1 } from '@standard-schema/spec';
import type { TaskDefinition } from './tasks.types';

export type TaskDefinitionRegistry = ReturnType<typeof createTaskRegistry>;

export function createTaskRegistry() {
  const taskDefinitions = new Map<string, TaskDefinition>();

  return {
    registerTask: <T extends StandardSchemaV1>(taskDefinition: TaskDefinition<T>) => {
      if (taskDefinitions.has(taskDefinition.taskName)) {
        throw new Error(`Task definition already exists: ${taskDefinition.taskName}`);
      }

      taskDefinitions.set(taskDefinition.taskName, taskDefinition as unknown as TaskDefinition);
    },
    getTask: ({ taskName }: { taskName: string }) => {
      const taskDefinition = taskDefinitions.get(taskName);

      return { taskDefinition };
    },
    getTaskOrThrow: ({ taskName }: { taskName: string }) => {
      const taskDefinition = taskDefinitions.get(taskName);

      if (!taskDefinition) {
        throw new Error(`Task definition not found: ${taskName}`);
      }

      return { taskDefinition };
    },
  };
}
