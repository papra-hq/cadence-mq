import type { StandardSchemaV1 } from '@standard-schema/spec';
import type { TaskDefinition } from '../tasks/task-definition';
import type { JsonValue } from '../shared/json';

export type Awaitable<Value> = Value | PromiseLike<Value>;

export type HandlerContext = {
  jobId: string;
  taskName: string;
  attempt: number;
  availableAt: Temporal.Instant;
  signal: AbortSignal;
  schedule?: {
    id: string;
    occurrenceAt: Temporal.Instant;
  };
};

const handlerDefinitionBrand: unique symbol = Symbol('CadenceHandlerDefinition');
const handlerDefinitionInternals: unique symbol = Symbol('CadenceHandlerDefinitionInternals');

export type HandlerDefinition = {
  readonly taskName: string;
  readonly [handlerDefinitionBrand]: true;
};

type HandlerInternals = {
  schema: StandardSchemaV1<unknown, JsonValue>;
  run: (payload: JsonValue, context: HandlerContext) => Awaitable<void>;
};

type InternalHandlerDefinition = HandlerDefinition & {
  readonly [handlerDefinitionInternals]: HandlerInternals;
};

export function defineHandler<Name extends string, Input, Payload extends JsonValue>(
  task: TaskDefinition<Name, Input, Payload>,
  run: (payload: Payload, context: HandlerContext) => Awaitable<void>,
): HandlerDefinition {
  return Object.freeze({
    taskName: task.name,
    [handlerDefinitionBrand]: true as const,
    [handlerDefinitionInternals]: {
      schema: task.schema,
      run: (payload: JsonValue, context: HandlerContext) => run(payload as Payload, context),
    },
  });
}

export function getHandlerInternals(handler: HandlerDefinition): HandlerInternals {
  const internals = (handler as InternalHandlerDefinition)[handlerDefinitionInternals];
  if (internals === undefined) {
    throw new TypeError('Invalid handler definition');
  }
  return internals;
}
