import type { TaskContext } from './tasks.types';

export function createTaskExecutionContext({ workerId }: { workerId: string }): { taskExecutionContext: TaskContext } {
  return {
    taskExecutionContext: {
      workerId,
    },
  };
}
