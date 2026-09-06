import type { ClaimedSchedule, Driver, NewJob } from '../driver/driver';
import { randomUUID } from 'node:crypto';
import { getNextExecutionDate } from '../cron/cron';
import { cloneJsonValue } from '../shared/json';
import { cloneRetryPolicy } from '../shared/retry';

/** Materializes the persisted due occurrence and skips missed ticks when advancing its cursor. */
export async function materializeSchedule(
  driver: Driver,
  schedule: ClaimedSchedule,
): Promise<boolean> {
  const lease = { id: schedule.id, token: schedule.leaseToken };

  try {
    const occurrenceAt = schedule.nextRunAt;
    const nextRunAt = getNextExecutionDate(schedule.trigger.cron, {
      after: schedule.claimedAt,
      timeZone: schedule.trigger.timeZone,
      hashSeed: schedule.id,
    });

    const job: NewJob = {
      id: randomUUID(),
      taskName: schedule.taskName,
      payload: cloneJsonValue(schedule.payload),
      retry: cloneRetryPolicy(schedule.retry),
      availableAt: occurrenceAt,
      schedule: { id: schedule.id, occurrenceAt },
    };

    return await driver.commitScheduleOccurrence({ lease, job, nextRunAt });
  } catch (error) {
    try {
      await driver.releaseScheduleClaim(lease);
    } catch {
      // Preserve the materialization error; an expired lease is independently reclaimable.
    }
    throw error;
  }
}
