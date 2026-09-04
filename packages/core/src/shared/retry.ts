import { createError } from '../../errors/errors.models';

export type FixedBackoff = {
  type: 'fixed';
  delayMs: number;
};

export type ExponentialBackoff = {
  type: 'exponential';
  initialDelayMs: number;
  maxDelayMs: number;
};

export type RetryPolicy = {
  maxAttempts: number;
  backoff?: FixedBackoff | ExponentialBackoff;
};

export function normalizeRetryPolicy(retry: RetryPolicy = { maxAttempts: 1 }): RetryPolicy {
  assertPositiveInteger(retry.maxAttempts, 'maxAttempts');

  if (retry.backoff === undefined) {
    return { maxAttempts: retry.maxAttempts };
  }

  if (retry.backoff.type === 'fixed') {
    assertDuration(retry.backoff.delayMs, 'delayMs');
    return {
      maxAttempts: retry.maxAttempts,
      backoff: { type: 'fixed', delayMs: retry.backoff.delayMs },
    };
  }

  if (retry.backoff.type === 'exponential') {
    assertDuration(retry.backoff.initialDelayMs, 'initialDelayMs');
    assertDuration(retry.backoff.maxDelayMs, 'maxDelayMs');
    return {
      maxAttempts: retry.maxAttempts,
      backoff: {
        type: 'exponential',
        initialDelayMs: retry.backoff.initialDelayMs,
        maxDelayMs: retry.backoff.maxDelayMs,
      },
    };
  }

  throw createInvalidRetryPolicyError();
}

export function cloneRetryPolicy(retry: RetryPolicy): RetryPolicy {
  return retry.backoff === undefined
    ? { maxAttempts: retry.maxAttempts }
    : { maxAttempts: retry.maxAttempts, backoff: { ...retry.backoff } };
}

function assertPositiveInteger(value: number, field: string): void {
  if (!Number.isInteger(value) || value < 1) {
    throw createInvalidRetryPolicyError(field);
  }
}

function assertDuration(value: number, field: string): void {
  if (!Number.isFinite(value) || !Number.isInteger(value) || value < 0) {
    throw createInvalidRetryPolicyError(field);
  }
}

function createInvalidRetryPolicyError(field?: string) {
  return createError({
    code: 'task.invalid-retry-policy',
    message: field === undefined ? 'Invalid retry policy' : `Invalid retry policy field: ${field}`,
  });
}
