import { describe, expect, test } from 'vitest';
import { retry } from './retry';

describe('retry', () => {
  describe('retry', () => {
    test('retry a function the given number of times if it fails', async () => {
      let attempts = 0;

      await expect(
        retry(
          () => {
            attempts++;
            throw new Error(`Reject ${attempts}`);
          },
          { maxRetries: 2 },
        ),
      ).rejects.toThrow('Reject 3');

      expect(attempts).toBe(3);
    });

    test('when the maxRetries is 0, the function is not retried', async () => {
      let attempts = 0;

      await expect(
        retry(
          () => {
            attempts++;
            throw new Error(`Reject ${attempts}`);
          },
          { maxRetries: 0 },
        ),
      ).rejects.toThrow('Reject 1');

      expect(attempts).toBe(1);
    });

    test('when the maxRetries is negative, an error is thrown', async () => {
      await expect(() =>
        retry(
          () => {
            throw new Error('test');
          },
          { maxRetries: -1 },
        ),
      ).rejects.toThrow('maxRetries must be greater than 0');
    });
  });
});
