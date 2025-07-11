import * as v from 'valibot';
import { describe, expectTypeOf, test } from 'vitest';
import z from 'zod';
import { createTaskRegistry } from './task-definition.registry';

describe('tasks types', () => {
  describe('taskDefinition', () => {
    test('when no schema is defined, the handler receives the data as unknown', () => {
      createTaskRegistry().registerTask({
        taskName: 'test',
        handler: async ({ data }) => {
          expectTypeOf(data).toEqualTypeOf<unknown>();
        },
      });
    });

    test('schemas can be defined with valibot', () => {
      createTaskRegistry().registerTask({
        taskName: 'test',
        schema: {
          data: v.string(),
        },
        handler: async ({ data }) => {
          expectTypeOf(data).toEqualTypeOf<string>();
        },
      });

      createTaskRegistry().registerTask({
        taskName: 'test',
        schema: {
          data: v.object({
            name: v.string(),
          }),
        },
        handler: async ({ data }) => {
          expectTypeOf(data).toEqualTypeOf<{ name: string }>();
        },
      });
    });

    test('schemas can be defined with zod', () => {
      createTaskRegistry().registerTask({
        taskName: 'test',
        schema: {
          data: z.object({
            name: z.string(),
          }),
        },
        handler: async ({ data }) => {
          expectTypeOf(data).toEqualTypeOf<{ name: string }>();
        },
      });
    });
  });
});
