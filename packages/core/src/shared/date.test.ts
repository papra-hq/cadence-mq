import { describe, expect, test } from 'vitest';
import { getNextExecutionDate } from './date';

describe('date', () => {
  describe('getNextExecutionDate', () => {
    test('get the next execution date for a given cron expression', () => {
      // If you see this test failing, it may be due to the timezone,
      // make sure to run the tests with TZ=UTC

      expect(
        getNextExecutionDate({
          cron: '0 0 * * *', // every day at 00:00
          relativeTo: new Date('2025-01-01T00:00:00.000Z'),
        }),
      ).to.eql({
        nextDate: new Date('2025-01-02T00:00:00.000Z'),
      });
    });

    test('throws an error if the cron expression is invalid', () => {
      expect(() => getNextExecutionDate({ cron: 'invalid' })).to.throw('Invalid cron expression');
      expect(() => getNextExecutionDate({ cron: ' ' })).to.throw('Invalid cron expression');
      expect(() => getNextExecutionDate({ cron: '' })).to.throw('Invalid cron expression');

      expect(() => getNextExecutionDate({ cron: '0 0 * * *' })).not.to.throw();
    });
  });
});
