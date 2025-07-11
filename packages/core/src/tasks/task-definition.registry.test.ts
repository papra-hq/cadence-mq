import { describe, expect, test } from 'vitest';
import { createTaskRegistry } from './task-definition.registry';

describe('task-definition registry', () => {
  describe('createTaskRegistry', () => {
    test('a task definition can can be registered and retrieved', () => {
      const registry = createTaskRegistry();

      const taskDefinition = {
        taskName: 'test-task',
        handler: async () => {},
      };

      registry.registerTask(taskDefinition);

      expect(registry.getTaskOrThrow({ taskName: 'test-task' })).to.eql({ taskDefinition });
    });

    test('when a retrieving a task definition that does not exist, an error is raised', () => {
      const registry = createTaskRegistry();

      expect(() => registry.getTaskOrThrow({ taskName: 'test' })).toThrowError('Task definition not found: test');
    });

    test('a task with the same name cannot be registered twice', () => {
      const registry = createTaskRegistry();

      registry.registerTask({ taskName: 'test-task', handler: async () => {} });

      expect(() => registry.registerTask({ taskName: 'test-task', handler: async () => {} })).toThrowError('Task definition already exists: test-task');
    });
  });
});
