import type { StandardSchemaV1 } from '@standard-schema/spec';
import type { JsonValue } from '../shared/json';
import { createError, isCadenceError } from '../../errors/errors.models';
import { assertJsonValue } from '../shared/json';

export function validatePayload<Input, Payload extends JsonValue>(
  schema: StandardSchemaV1<Input, Payload>,
  input: unknown,
): Payload {
  let result: StandardSchemaV1.Result<Payload> | Promise<StandardSchemaV1.Result<Payload>>;

  try {
    result = schema['~standard'].validate(input);
  } catch (cause) {
    throw createError({
      code: 'payload.validation-failed',
      message: 'Payload validation failed',
      cause,
    });
  }

  if (isPromiseLike(result)) {
    throw createError({
      code: 'schema.async-validation-unsupported',
      message: 'Task schemas must validate synchronously',
    });
  }

  if (result.issues !== undefined) {
    throw createError({
      code: 'payload.invalid',
      message: formatIssues(result.issues),
      cause: result.issues,
    });
  }

  try {
    assertJsonValue(result.value);
  } catch (error) {
    if (isCadenceError(error)) {
      throw error;
    }
    throw createError({
      code: 'payload.not-json',
      message: 'Schema output must be JSON-compatible',
      cause: error,
    });
  }

  return result.value;
}

function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
  return (
    (typeof value === 'object' || typeof value === 'function') &&
    value !== null &&
    typeof Reflect.get(value, 'then') === 'function'
  );
}

function formatIssues(issues: ReadonlyArray<StandardSchemaV1.Issue>): string {
  const [firstIssue] = issues;
  return firstIssue === undefined ? 'Invalid payload' : `Invalid payload: ${firstIssue.message}`;
}
