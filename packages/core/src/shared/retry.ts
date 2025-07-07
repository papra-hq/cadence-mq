export async function retry<T>(
  fn: () => Promise<T>,
  { maxRetries = 0 }: { maxRetries?: number } = {},
): Promise<T> {
  if (maxRetries < 0) {
    throw new TypeError('maxRetries must be greater than 0');
  }

  let attempts = 0;
  let lastError: unknown | undefined;

  while (attempts < maxRetries + 1) {
    try {
      return await fn();
    } catch (error) {
      attempts++;
      lastError = error;
    }
  }

  throw lastError;
}
