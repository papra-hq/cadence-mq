import { CronExpressionParser } from 'cron-parser';
import { createInvalidCronExpressionError } from '../../errors/errors.definitions';
import type { Clock } from '../clock/clock.types';
import { systemClock } from '../clock/system-clock';

export function getNextExecutionDate(
  cron: string,
  {
    clock = systemClock,
  }: {
    clock?: Clock;
  } = {},
): Temporal.Instant {
  if (cron.trim() === '') {
    throw createInvalidCronExpressionError();
  }
  try {
    const interval = CronExpressionParser.parse(cron, {
      currentDate: clock.now().epochMilliseconds,
    });

    return interval.next().toDate().toTemporalInstant();
  } catch (error) {
    throw createInvalidCronExpressionError({ cause: error });
  }
}
