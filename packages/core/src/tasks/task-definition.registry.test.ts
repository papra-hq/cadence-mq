import { describe, expect, test } from 'vitest';
import { createTaskDefinitionRegistry } from './task-definition.registry';

describe('task-definition registry', () => {
  describe('createTaskDefinitionRegistry', () => {
    test('a task definition can can be registered and retrieved', () => {
      const registry = createTaskDefinitionRegistry();

      const taskDefinition = {
        name: 'test-task',
        handler: async () => {},
      };

      registry.saveTaskDefinition({ taskDefinition });

      expect(registry.getTaskDefinitionOrThrow({ taskName: 'test-task' })).to.eql({ taskDefinition });
    });

    test('when a retrieving a task definition that does not exist, an error is raised', () => {
      const registry = createTaskDefinitionRegistry();

      expect(() => registry.getTaskDefinitionOrThrow({ taskName: 'test' })).toThrowError('Task definition not found: test');
    });

    test('a task with the same name cannot be registered twice', () => {
      const registry = createTaskDefinitionRegistry();

      registry.saveTaskDefinition({ taskDefinition: { name: 'test-task', handler: async () => {} } });

      expect(() => registry.saveTaskDefinition({ taskDefinition: { name: 'test-task', handler: async () => {} } })).toThrowError('Task definition already exists: test-task');
    });
  });
});
