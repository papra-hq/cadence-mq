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

export class CadenceError extends Error {
  isCadenceError = true;
  code: string;

  constructor({ message, cause, code }: { message: string; cause?: unknown; code: string }) {
    super(message);
    this.cause = cause;
    this.code = code;
    this.name = 'CadenceError';
  }
}

export function isCadenceError(error: unknown): error is CadenceError {
  return error instanceof CadenceError;
}

export function createError({ message, cause, code }: { message: string; cause?: unknown; code: string }): CadenceError {
  return new CadenceError({ message, cause, code });
}

export function createErrorFactory(factorySettings: { code: string; message: string }) {
  return (instanceSettings: { cause?: unknown; message?: string; code?: string } = {}) => createError({
    message: instanceSettings.message ?? factorySettings.message,
    cause: instanceSettings.cause,
    code: instanceSettings.code ?? factorySettings.code,
  });
}
