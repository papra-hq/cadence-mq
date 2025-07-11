export function serializeError({ error }: { error: unknown }): string {
  if (error instanceof Error) {
    return `${error.message}\n\n${error.stack}`;
  }

  if (typeof error === 'object' && error !== null) {
    return JSON.stringify(error);
  }

  return String(error);
}

function castError(error: unknown): Error {
  if (error instanceof Error) {
    return error;
  }

  return new Error(String(error));
}

export function safely<T>(fn: Promise<T>): Promise<[Error, undefined] | [undefined, T]> {
  return fn
    .then(result => [undefined, result] as [undefined, T])
    .catch(error => [castError(error), undefined] as [Error, undefined]);
}
