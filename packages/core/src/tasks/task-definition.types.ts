import type { TaskDefinition } from './tasks.types';

export type TaskDefinitionRegistry = {
  add: (taskDefinition: TaskDefinition) => void;
  get: (name: string) => TaskDefinition;
};
