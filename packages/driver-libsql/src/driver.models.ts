import type { JobUpdate } from '@cadence-mq/core';
import type { InValue } from '@libsql/client';

export function buildUpdateJobSetClause({ values }: { values: JobUpdate }): { setClause: string; args: InValue[] } {
  const fields = {
    status: 'status',
    error: 'error',
    result: 'result',
    startedAt: 'started_at',
    completedAt: 'completed_at',
    maxRetries: 'max_retries',
    data: 'data',
    cron: 'cron',
    scheduledAt: 'scheduled_at',
  };

  const fieldsKeys = Object.keys(fields);
  const valuesEntries = Object.entries(values)
    .filter(([key]) => fieldsKeys.includes(key))
    .filter(([, value]) => value !== undefined)
    .sort(([keyA], [keyB]) => fields[keyA].localeCompare(fields[keyB]));

  if (valuesEntries.length === 0) {
    throw new Error('No fields to update');
  }

  const setClause = valuesEntries
    .map(([key]) => `${fields[key]} = ?`)
    .join(', ');

  const args = valuesEntries
    .map(([, value]) => value)
    .map((value) => {
      if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
        return value;
      }

      if (value instanceof Date) {
        return value;
      }

      return JSON.stringify(value);
    });

  return { setClause, args };
}
