import type { JobUpdate } from '@cadence-mq/core';
import { describe, expect, test } from 'vitest';
import { buildUpdateJobSetClause } from './driver.models';

describe('driver models', () => {
  describe('buildUpdateJobSetClause', () => {
    test('given a record of field to update, it generates the sql SET clause with placeholders and the args for those placeholders', () => {
      expect(
        buildUpdateJobSetClause({ values: {
          error: 'error message',
          status: 'completed',
          result: '{"foo": "bar"}',
        } }),
      ).to.eql({
        setClause: 'error = ?, result = ?, status = ?',
        args: ['error message', '{"foo": "bar"}', 'completed'],
      });
    });

    test('in order to be determinist, it sorts the fields by their key', () => {
      expect(
        buildUpdateJobSetClause({ values: {
          result: '{"foo": "bar"}',
          error: 'error message',
          status: 'completed',
        } }),
      ).to.eql({
        setClause: 'error = ?, result = ?, status = ?',
        args: ['error message', '{"foo": "bar"}', 'completed'],
      });
    });

    test('unknown fields are ignored', () => {
      expect(
        buildUpdateJobSetClause({
          values: {
            foo: 'bar',
            status: 'completed',
          } as JobUpdate,
        }),
      ).to.eql({
        setClause: 'status = ?',
        args: ['completed'],
      });
    });

    test('if no fields are provided, it throws an error', () => {
      expect(() => buildUpdateJobSetClause({ values: {} as JobUpdate })).to.throw();
    });

    test('it serializes the values to json if they are not strings, numbers, booleans, or dates', () => {
      expect(
        buildUpdateJobSetClause({
          values: {
            data: { foo: 'bar' },
            scheduledAt: new Date('2021-01-01'),
            maxRetries: 1,
          },
        }),
      ).to.eql({
        setClause: 'data = ?, max_retries = ?, scheduled_at = ?',
        args: ['{"foo":"bar"}', 1, new Date('2021-01-01')],
      });
    });
  });
});
