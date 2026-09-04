import { createErrorFactory } from './errors.models';

export const createInvalidCronExpressionError = createErrorFactory({
  code: 'jobs.invalid-cron-expression',
  message: 'Invalid cron expression',
});
