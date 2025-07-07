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

      registry.add(taskDefinition);

      expect(registry.get('test-task')).to.eql(taskDefinition);
    });

    test('when a retrieving a task definition that does not exist, an error is raised', () => {
      const registry = createTaskDefinitionRegistry();

      expect(() => registry.get('test')).toThrowError('Task definition not found: test');
    });

    test('a task with the same name cannot be registered twice', () => {
      const registry = createTaskDefinitionRegistry();

      registry.add({ name: 'test-task', handler: async () => {} });

      expect(() => registry.add({ name: 'test-task', handler: async () => {} })).toThrowError('Task definition already exists: test-task');
    });
  });
});
