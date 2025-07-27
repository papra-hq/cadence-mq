import { runTestSuites } from '@cadence-mq/test-suites';
import { createClient } from '@libsql/client';
import { drizzle } from 'drizzle-orm/libsql';
import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { describe } from 'vitest';
import { createDrizzleDriver } from './driver';
import { setupSchema } from './migrations';

const POLL_INTERVAL_MS = 1_000;

export const jobsTable = sqliteTable('jobs', {
  id: text('id').primaryKey(),
  status: text('status').notNull(),
  scheduledAt: integer('scheduled_at', { mode: 'timestamp_ms' }).notNull(),
  taskName: text('task_name').notNull(),
  data: text('data').notNull(),
  result: text('result'),
  error: text('error'),
  maxRetries: integer('max_retries'),
  cron: text('cron'),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  startedAt: integer('started_at', { mode: 'timestamp_ms' }),
  completedAt: integer('completed_at', { mode: 'timestamp_ms' }),
  deleteJobOnCompletion: integer('delete_job_on_completion', { mode: 'boolean' }).notNull().default(false),
});

describe('drizzle driver', () => {
  describe('with a libsql memory database', () => {
    runTestSuites({
      createDriver: async () => {
        const client = createClient({ url: ':memory:' });
        await setupSchema({ client });

        const driver = createDrizzleDriver({ db: drizzle(client), pollIntervalMs: POLL_INTERVAL_MS, schema: { jobs: jobsTable } });

        return { driver };
      },
      processingLatencyMs: POLL_INTERVAL_MS,
    });
  });
});
