import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

export const jobsTable = sqliteTable('jobs', {
  id: text('id').primaryKey(),
  status: text('status').notNull(),
  scheduledAt: text('scheduled_at').notNull(),
  taskName: text('task_name').notNull(),
  data: text('data').notNull(),
  result: text('result'),
  error: text('error'),
  maxRetries: integer('max_retries'),
  cron: text('cron'),
  createdAt: text('created_at').notNull(),
  startedAt: text('started_at'),
  completedAt: text('completed_at'),
});
