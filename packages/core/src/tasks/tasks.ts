import type { TaskDefinitionRegistry } from './task-definition.types';
import type { TaskDefinition } from './tasks.types';

export function registerTask({ taskDefinitionRegistry, ...taskDefinition }: TaskDefinition & { taskDefinitionRegistry: TaskDefinitionRegistry }) {
  taskDefinitionRegistry.add(taskDefinition);
}
