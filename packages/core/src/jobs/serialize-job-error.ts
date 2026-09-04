import type { SerializedJobError } from './job';

export function serializeJobError(error: unknown): SerializedJobError {
  const name = readStringProperty(error, 'name') ?? 'Error';
  const message = readStringProperty(error, 'message') ?? stringifyThrownValue(error);
  const stack = readStringProperty(error, 'stack');
  const code = readStringProperty(error, 'code');

  return {
    name,
    message,
    ...(stack === undefined ? {} : { stack }),
    ...(code === undefined ? {} : { code }),
  };
}

function readStringProperty(value: unknown, property: string): string | undefined {
  if ((typeof value !== 'object' && typeof value !== 'function') || value === null) {
    return undefined;
  }

  try {
    const propertyValue = Reflect.get(value, property);
    return typeof propertyValue === 'string' ? propertyValue : undefined;
  } catch {
    return undefined;
  }
}

function stringifyThrownValue(value: unknown): string {
  if (typeof value === 'string') {
    return value;
  }

  try {
    const serialized = JSON.stringify(value);
    if (serialized !== undefined) {
      return serialized;
    }
  } catch {
    // Fall back to JavaScript's string coercion for circular and otherwise unserializable values.
  }

  try {
    return String(value);
  } catch {
    return 'Unknown error';
  }
}
