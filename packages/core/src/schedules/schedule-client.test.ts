import type { Driver, ScheduleUpsert } from '../index';
import { describe, expect, test } from 'vitest';
import * as v from 'valibot';
import { createCadence, defineTask, isCadenceError } from '../index';

const now = Temporal.Instant.from('2026-01-01T08:30:00Z');

function recordingDriver() {
  let initializations = 0;
  let upsert: ScheduleUpsert | undefined;
  const driver: Driver = {
    name: 'schedule-recording',
    initialize: async () => {
      initializations += 1;
    },
    close: async () => {},
    now: async () => now,
    insertJob: async () => {
      throw new Error('not implemented');
    },
    getJob: async () => undefined,
    pruneJobs: async () => 0,
    claimJobs: async () => [],
    renewJobLeases: async () => [],
    completeJob: async () => false,
    retryJob: async () => false,
    failJob: async () => false,
    upsertSchedule: async (value) => {
      upsert = value;
      return {
        ...value,
        createdAt: now,
        updatedAt: now,
      };
    },
    getSchedule: async () => undefined,
    deleteSchedule: async () => false,
    claimDueSchedules: async () => [],
    commitScheduleOccurrence: async () => false,
    releaseScheduleClaim: async () => false,
  };
  return {
    driver,
    initializations: () => initializations,
    upsert: () => upsert,
  };
}

describe('schedule client', () => {
  test('schema output, normalized retry, UTC, and a strictly future cursor are persisted', async () => {
    const recording = recordingDriver();
    const cadence = createCadence({ driver: recording.driver });
    const task = defineTask({
      name: 'reports.create',
      schema: v.pipe(
        v.string(),
        v.transform((value) => ({ value: value.trim() })),
      ),
    });

    const result = await cadence.schedules.upsert({
      id: 'reports.daily',
      task,
      payload: ' report ',
      trigger: { cron: '30 8 * * *' },
    });

    expect(recording.upsert()).toMatchObject({
      id: 'reports.daily',
      payload: { value: 'report' },
      retry: { maxAttempts: 1 },
      trigger: { cron: '30 8 * * *', timeZone: 'UTC' },
    });
    expect(result.nextRunAt.toString()).toBe('2026-01-02T08:30:00Z');
  });

  test.each([
    { id: '', payload: 'ok', trigger: { cron: '* * * * *' }, code: 'schedule.invalid-id' },
    {
      id: 'reports.daily',
      payload: '',
      trigger: { cron: '* * * * *' },
      code: 'payload.invalid',
    },
    {
      id: 'reports.daily',
      payload: 'ok',
      trigger: { cron: 'invalid' },
      code: 'schedule.invalid-trigger',
    },
    {
      id: 'reports.daily',
      payload: 'ok',
      trigger: { cron: '* * * * *', timeZone: 'Invalid/Zone' },
      code: 'schedule.invalid-trigger',
    },
  ])('invalid configuration %# is rejected before driver work', async (input) => {
    const recording = recordingDriver();
    const cadence = createCadence({ driver: recording.driver });
    const task = defineTask({ name: 'reports.create', schema: v.pipe(v.string(), v.minLength(1)) });

    await expect(
      cadence.schedules.upsert({
        id: input.id,
        task,
        payload: input.payload,
        trigger: input.trigger,
      }),
    ).rejects.toSatisfy((error: unknown) => isCadenceError(error) && error.code === input.code);
    expect(recording.initializations()).toBe(0);
    expect(recording.upsert()).toBeUndefined();
  });

  test('schedule lookup and deletion validate IDs before initialization', async () => {
    const recording = recordingDriver();
    const cadence = createCadence({ driver: recording.driver });

    await expect(cadence.schedules.get('bad id')).rejects.toMatchObject({
      code: 'schedule.invalid-id',
    });
    await expect(cadence.schedules.delete('.bad')).rejects.toMatchObject({
      code: 'schedule.invalid-id',
    });
    expect(recording.initializations()).toBe(0);
  });
});
