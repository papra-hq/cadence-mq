import { describe, expect, test } from 'vitest';
import { createTaskExecutionContext } from './tasks.models';

describe('tasks models', () => {
  describe('createTaskExecutionContext', () => {
    test('the task execution context contains data about the worker that is executing the task', () => {
      expect(
        createTaskExecutionContext({ workerId: '123' }),
      ).eql({
        taskExecutionContext: { workerId: '123' },
      });
    });
  });
});
