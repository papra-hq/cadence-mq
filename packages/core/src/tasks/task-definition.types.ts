import type { TaskDefinition } from './tasks.types';

export type TaskDefinitionRegistry = {
  saveTaskDefinition: ({ taskDefinition }: { taskDefinition: TaskDefinition }) => void;
  getTaskDefinitionOrThrow: ({ taskName }: { taskName: string }) => { taskDefinition: TaskDefinition };
};
