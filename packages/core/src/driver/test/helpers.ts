import type { Driver, NewJob, ScheduleUpsert } from '../driver';

export const testScheduleId = 'driver-test.schedule';
export const testScheduleTaskName = 'driver-test.scheduled';

export async function scheduleUpsert(
  driver: Driver,
  overrides: Partial<ScheduleUpsert> = {},
): Promise<ScheduleUpsert> {
  return {
    id: testScheduleId,
    taskName: testScheduleTaskName,
    payload: { nested: { value: 'original' } },
    retry: { maxAttempts: 2 },
    trigger: { cron: '* * * * *', timeZone: 'UTC' },
    nextRunAt: await driver.now(),
    ...overrides,
  };
}

export function occurrenceJob(id: string, occurrenceAt: Temporal.Instant): NewJob {
  return {
    id,
    taskName: testScheduleTaskName,
    payload: { nested: { value: 'original' } },
    retry: { maxAttempts: 2 },
    availableAt: occurrenceAt,
    schedule: { id: testScheduleId, occurrenceAt },
  };
}
