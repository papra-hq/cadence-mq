import type { DatabaseClient } from '../database/database.types';

export const INDEX_NAME = 'jobs_status_scheduled_at_started_at_idx';
export const JOBS_TABLE_NAME = 'jobs';

export async function up(db: DatabaseClient): Promise<void> {
  await db.schema
    .createTable(JOBS_TABLE_NAME)
    .addColumn('id', 'text', col => col.notNull())
    .addColumn('task_name', 'text', col => col.notNull())
    .addColumn('data', 'text')
    .addColumn('status', 'text', col => col.notNull())
    .addColumn('started_at', 'datetime')
    .addColumn('completed_at', 'datetime')
    .addColumn('result', 'text')
    .addColumn('error', 'text')
    .addColumn('max_retries', 'integer')
    .addColumn('scheduled_at', 'datetime', col => col.notNull())
    .addColumn('cron', 'text')
    .execute();

  await db.schema
    .createIndex(INDEX_NAME)
    .on(JOBS_TABLE_NAME)
    .columns(['status', 'scheduled_at', 'started_at'])
    .execute();
}

export async function down(db: DatabaseClient): Promise<void> {
  await db.schema.dropTable(JOBS_TABLE_NAME).execute();
  await db.schema.dropIndex(INDEX_NAME).execute();
}
