import { CronExpressionParser } from 'cron-parser';
import { createError } from '../../errors/errors.models';
import { normalizeInstant } from '../shared/instant';

export type NextExecutionOptions = {
  after: Temporal.InstantLike;
  timeZone?: string;
  /** Keeps cron-parser's hashed fields stable for a durable schedule. */
  hashSeed?: string;
};

/** Returns the first cron occurrence strictly after the supplied instant. */
export function getNextExecutionDate(
  cron: string,
  { after, timeZone = 'UTC', hashSeed }: NextExecutionOptions,
): Temporal.Instant {
  if (typeof cron !== 'string') {
    throw createInvalidTriggerError();
  }
  const fieldCount = cron.trim().split(/\s+/).filter(Boolean).length;
  if (fieldCount !== 5 && fieldCount !== 6) {
    throw createInvalidTriggerError();
  }
  if (!isIanaTimeZone(timeZone)) {
    throw createInvalidTriggerError();
  }

  try {
    const interval = CronExpressionParser.parse(cron, {
      currentDate: normalizeInstant(after).epochMilliseconds,
      tz: timeZone,
      hashSeed,
    });

    return normalizeInstant(interval.next().toDate().toTemporalInstant());
  } catch (cause) {
    throw createInvalidTriggerError(cause);
  }
}

function isIanaTimeZone(timeZone: unknown): timeZone is string {
  if (
    typeof timeZone !== 'string' ||
    timeZone.trim() === '' ||
    timeZone.startsWith('+') ||
    timeZone.startsWith('-')
  ) {
    return false;
  }
  try {
    new Intl.DateTimeFormat('en-US', { timeZone }).format();
    return true;
  } catch {
    return false;
  }
}

function createInvalidTriggerError(cause?: unknown) {
  return createError({
    code: 'schedule.invalid-trigger',
    message: 'Invalid cron expression or IANA time zone',
    cause,
  });
}
