export function serializeError({ error }: { error: unknown }): string {
  if (error instanceof Error) {
    return `${error.message}\n\n${error.stack}`;
  }

  if (typeof error === 'object' && error !== null) {
    return JSON.stringify(error);
  }

  return String(error);
}
