import type { Client } from '@libsql/client';

export const migrationVersion = 2;

const createMigrationTable = `
  CREATE TABLE IF NOT EXISTS cadence_migrations (
    version INTEGER PRIMARY KEY,
    applied_at INTEGER NOT NULL
  )
`;

const versionOneMigration = [
  `
    CREATE TABLE IF NOT EXISTS cadence_jobs (
      id TEXT PRIMARY KEY,
      task_name TEXT NOT NULL,
      payload TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('pending', 'running', 'succeeded', 'failed')),
      attempts INTEGER NOT NULL,
      retry_json TEXT NOT NULL,
      max_attempts INTEGER NOT NULL,
      created_at INTEGER NOT NULL,
      available_at INTEGER NOT NULL,
      started_at INTEGER,
      finished_at INTEGER,
      last_error TEXT,
      schedule_id TEXT,
      schedule_occurrence_at INTEGER,
      lease_token TEXT,
      lease_expires_at INTEGER
    )
  `,
  `
    CREATE INDEX IF NOT EXISTS cadence_jobs_claim_idx
    ON cadence_jobs (status, task_name, available_at, lease_expires_at, created_at, id)
  `,
  `
    INSERT OR IGNORE INTO cadence_migrations (version, applied_at)
    VALUES (1, ${databaseNowExpression()})
  `,
];

const versionTwoMigration = [
  `
    CREATE TABLE IF NOT EXISTS cadence_schedules (
      id TEXT PRIMARY KEY,
      task_name TEXT NOT NULL,
      payload TEXT NOT NULL,
      retry_json TEXT NOT NULL,
      cron TEXT NOT NULL,
      time_zone TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      next_run_at INTEGER NOT NULL,
      last_materialized_at INTEGER,
      lease_token TEXT,
      lease_expires_at INTEGER
    )
  `,
  `
    CREATE INDEX IF NOT EXISTS cadence_schedules_due_idx
    ON cadence_schedules (next_run_at, lease_expires_at, id)
  `,
  `
    CREATE UNIQUE INDEX IF NOT EXISTS cadence_jobs_schedule_occurrence_idx
    ON cadence_jobs (schedule_id, schedule_occurrence_at)
    WHERE schedule_id IS NOT NULL AND schedule_occurrence_at IS NOT NULL
  `,
  `
    INSERT OR IGNORE INTO cadence_migrations (version, applied_at)
    VALUES (2, ${databaseNowExpression()})
  `,
];

export async function migrate(client: Client): Promise<void> {
  await client.execute(createMigrationTable);

  let version = await readMigrationVersion(client);
  if (version > migrationVersion) {
    throw new Error(`Database migration version ${version} is newer than this driver`);
  }
  if (version < 1) {
    await client.batch(versionOneMigration, 'write');
    version = await readMigrationVersion(client);
  }
  if (version < 2) {
    // Some v1 databases already pre-provisioned occurrence metadata. Build one
    // resumable migration batch that adds only the columns this database lacks.
    const jobColumns = await readJobColumns(client);
    const statements = [
      ...(jobColumns.has('schedule_id')
        ? []
        : ['ALTER TABLE cadence_jobs ADD COLUMN schedule_id TEXT']),
      ...(jobColumns.has('schedule_occurrence_at')
        ? []
        : ['ALTER TABLE cadence_jobs ADD COLUMN schedule_occurrence_at INTEGER']),
      ...versionTwoMigration,
    ];

    try {
      await client.batch(statements, 'write');
    } catch (error) {
      // Another initializer may have applied v2 after our schema/version reads. A
      // committed migration version proves its schema changes completed atomically.
      if ((await readMigrationVersion(client)) < 2) {
        throw error;
      }
    }
  }
}

async function readJobColumns(client: Client): Promise<ReadonlySet<string>> {
  const result = await client.execute("SELECT name FROM pragma_table_info('cadence_jobs')");
  return new Set(result.rows.flatMap(({ name }) => (typeof name === 'string' ? [name] : [])));
}

async function readMigrationVersion(client: Client): Promise<number> {
  const result = await client.execute('SELECT MAX(version) AS version FROM cadence_migrations');
  return Number(result.rows[0]?.version ?? 0);
}

export function databaseNowExpression(): string {
  return `(
    CAST(strftime('%s', 'now') AS INTEGER) * 1000
    + CAST(substr(strftime('%f', 'now'), 4, 3) AS INTEGER)
  )`;
}
