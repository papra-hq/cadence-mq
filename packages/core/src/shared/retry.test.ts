import { describe, expect, test } from 'vitest';
import { retryDelay } from './retry';

describe('retryDelay', () => {
  test('an omitted backoff makes every retry immediately available', () => {
    expect(retryDelay({ maxAttempts: 5 }, 1)).toBe(0);
    expect(retryDelay({ maxAttempts: 5 }, 4)).toBe(0);
  });

  test('fixed backoff returns the configured delay for every failed attempt', () => {
    const retry = { maxAttempts: 5, backoff: { type: 'fixed', delayMs: 250 } } as const;

    expect(retryDelay(retry, 1)).toBe(250);
    expect(retryDelay(retry, 4)).toBe(250);
  });

  test('exponential backoff doubles from the failed attempt and stops at its cap', () => {
    const retry = {
      maxAttempts: 6,
      backoff: { type: 'exponential', initialDelayMs: 100, maxDelayMs: 500 },
    } as const;

    expect(retryDelay(retry, 1)).toBe(100);
    expect(retryDelay(retry, 2)).toBe(200);
    expect(retryDelay(retry, 3)).toBe(400);
    expect(retryDelay(retry, 4)).toBe(500);
    expect(retryDelay(retry, 5)).toBe(500);
  });

  test('zero exponential delay remains zero for large attempt numbers', () => {
    const retry = {
      maxAttempts: 2_000,
      backoff: { type: 'exponential', initialDelayMs: 0, maxDelayMs: 1_000 },
    } as const;

    expect(retryDelay(retry, 1_500)).toBe(0);
  });
});
