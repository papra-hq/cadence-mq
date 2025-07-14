import { CronExpressionParser } from 'cron-parser';
import { createInvalidCronExpressionError } from '../errors/errors.definitions';

export function getNextExecutionDate({ cron, relativeTo = new Date() }: { cron: string; relativeTo?: Date }) {
  if (cron.trim() === '') {
    throw createInvalidCronExpressionError();
  }
  try {
    const interval = CronExpressionParser.parse(cron, { currentDate: relativeTo });

    const nextDate = interval.next().toDate();

    return { nextDate };
  } catch (error) {
    throw createInvalidCronExpressionError({ cause: error });
  }
}
