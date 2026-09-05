import { describe, expect, test } from 'vitest';
import { getNextExecutionDate } from './cron';

function next(cron: string, after: string, timeZone = 'UTC'): string {
  return getNextExecutionDate(cron, {
    after: Temporal.Instant.from(after),
    timeZone,
  }).toString();
}

describe('getNextExecutionDate', () => {
  test('five-field expressions return the first occurrence strictly after the boundary', () => {
    expect(next('0 9 * * *', '2026-01-01T09:00:00Z')).toBe('2026-01-02T09:00:00Z');
  });

  test('six-field expressions include their leading seconds field', () => {
    expect(next('15 * * * * *', '2026-01-01T00:00:15Z')).toBe('2026-01-01T00:01:15Z');
  });

  test('hashed fields remain stable when a durable seed is supplied', () => {
    const first = getNextExecutionDate('H * * * *', {
      after: '2026-01-01T00:00:00Z',
      hashSeed: 'reports.daily',
    });
    const second = getNextExecutionDate('H * * * *', {
      after: first,
      hashSeed: 'reports.daily',
    });

    expect(second.since(first).total('hours')).toBe(1);
  });

  test('Europe/Paris occurrences use winter and summer UTC offsets', () => {
    expect(next('0 9 * * *', '2026-01-01T00:00:00Z', 'Europe/Paris')).toBe('2026-01-01T08:00:00Z');
    expect(next('0 9 * * *', '2026-07-01T00:00:00Z', 'Europe/Paris')).toBe('2026-07-01T07:00:00Z');
  });

  test('a spring DST gap follows cron-parser time-zone behavior', () => {
    expect(next('30 2 * * *', '2026-03-28T02:00:00Z', 'Europe/Paris')).toBe('2026-03-29T01:30:00Z');
  });

  test('a fall DST overlap produces one occurrence for the repeated wall time', () => {
    expect(next('30 2 * * *', '2026-10-25T00:00:00Z', 'Europe/Paris')).toBe('2026-10-25T00:30:00Z');
    expect(next('30 2 * * *', '2026-10-25T00:30:00Z', 'Europe/Paris')).toBe('2026-10-26T01:30:00Z');
  });

  test.each([
    ['', 'UTC'],
    ['5', 'UTC'],
    ['* *', 'UTC'],
    ['* * *', 'UTC'],
    ['* * * *', 'UTC'],
    ['@daily', 'UTC'],
    ['not a cron', 'UTC'],
    ['0 9 * * *', 'Mars/Olympus_Mons'],
    ['0 9 * * *', 'local'],
    ['0 9 * * *', 'system'],
    ['0 9 * * *', 'default'],
    ['0 9 * * *', 'UTC+6'],
    ['0 9 * * *', '+01:00'],
    ['0 9 * * *', '-08:00'],
    ['0 9 * * *', ''],
  ])('invalid trigger %# is rejected', (cron, timeZone) => {
    expect(() => next(cron, '2026-01-01T00:00:00Z', timeZone)).toThrowError(
      expect.objectContaining({ code: 'schedule.invalid-trigger' }),
    );
  });
});
