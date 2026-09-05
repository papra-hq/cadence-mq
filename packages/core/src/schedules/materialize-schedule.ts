import type { ClaimedSchedule, Driver, NewJob } from '../driver/driver';
import { randomUUID } from 'node:crypto';
import { getNextExecutionDate } from '../cron/cron';
import { cloneJsonValue } from '../shared/json';
import { cloneRetryPolicy } from '../shared/retry';

/** Materializes the latest due occurrence and atomically advances its durable cursor. */
export async function materializeSchedule(
  driver: Driver,
  schedule: ClaimedSchedule,
): Promise<boolean> {
  const lease = { id: schedule.id, token: schedule.leaseToken };

  try {
    let occurrenceAt = schedule.nextRunAt;
    let nextRunAt = next(schedule, occurrenceAt);

    while (Temporal.Instant.compare(nextRunAt, schedule.claimedAt) <= 0) {
      occurrenceAt = nextRunAt;
      nextRunAt = next(schedule, occurrenceAt);
    }

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

function next(schedule: ClaimedSchedule, after: Temporal.Instant): Temporal.Instant {
  return getNextExecutionDate(schedule.trigger.cron, {
    after,
    timeZone: schedule.trigger.timeZone,
    hashSeed: schedule.id,
  });
}
