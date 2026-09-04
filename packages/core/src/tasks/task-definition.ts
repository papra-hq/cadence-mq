import type { StandardSchemaV1 } from '@standard-schema/spec';
import type { JsonValue } from '../shared/json';
import type { RetryPolicy } from '../shared/retry';
import { createError } from '../../errors/errors.models';
import { normalizeRetryPolicy } from '../shared/retry';

const taskNamePattern = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

export type TaskDefinition<
  Name extends string = string,
  Input = unknown,
  Payload extends JsonValue = JsonValue,
> = {
  readonly name: Name;
  readonly schema: StandardSchemaV1<Input, Payload>;
  readonly retry: RetryPolicy;
};

export type DefineTaskOptions<Name extends string, Input, Payload extends JsonValue> = {
  name: Name;
  schema: StandardSchemaV1<Input, Payload>;
  retry?: RetryPolicy;
};

export function defineTask<const Name extends string, Input, Payload extends JsonValue>(
  options: DefineTaskOptions<Name, Input, Payload>,
): TaskDefinition<Name, Input, Payload> {
  assertTaskName(options.name);

  return Object.freeze({
    name: options.name,
    schema: options.schema,
    retry: Object.freeze(normalizeRetryPolicy(options.retry)),
  });
}

function assertTaskName(name: string): void {
  if (name.length < 1 || name.length > 128 || !taskNamePattern.test(name)) {
    throw createError({
      code: 'task.invalid-name',
      message: 'Task names must be 1-128 characters and match /^[A-Za-z0-9][A-Za-z0-9._-]*$/',
    });
  }
}
