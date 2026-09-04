import { createError } from '../../errors/errors.models';

export type JsonPrimitive = null | boolean | number | string;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

export function assertJsonValue(value: unknown): asserts value is JsonValue {
  try {
    visitJsonValue(value, new Set<object>());
  } catch (cause) {
    throw createError({
      code: 'payload.not-json',
      message: 'Schema output must be JSON-compatible',
      cause,
    });
  }
}

export function cloneJsonValue<Payload extends JsonValue>(payload: Payload): Payload {
  return structuredClone(payload);
}

function visitJsonValue(value: unknown, ancestors: Set<object>): void {
  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'boolean' ||
    (typeof value === 'number' && Number.isFinite(value))
  ) {
    return;
  }

  if (typeof value !== 'object') {
    throw new TypeError(`Unsupported JSON value: ${typeof value}`);
  }

  if (ancestors.has(value)) {
    throw new TypeError('Circular values are not JSON-compatible');
  }

  ancestors.add(value);

  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      if (!(index in value)) {
        throw new TypeError('Sparse arrays are not JSON-compatible');
      }
      visitJsonValue(value[index], ancestors);
    }
  } else {
    const prototype: unknown = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new TypeError('Only plain objects are JSON-compatible');
    }
    if (Object.getOwnPropertySymbols(value).length > 0) {
      throw new TypeError('Symbol properties are not JSON-compatible');
    }

    for (const propertyValue of Object.values(value)) {
      visitJsonValue(propertyValue, ancestors);
    }
  }

  ancestors.delete(value);
}
