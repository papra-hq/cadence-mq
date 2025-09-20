import type { Client } from '@libsql/client';

export function getSchema({ withPragma = true }: { withPragma?: boolean } = {}) {
  return /* sql */`
${withPragma
  ? /* sql */`
PRAGMA journal_mode = WAL;
PRAGMA synchronous = 1;
PRAGMA busy_timeout = 5000;
  `
  : ''}

CREATE TABLE IF NOT EXISTS jobs (
  id TEXT PRIMARY KEY,
  task_name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at DATETIME NOT NULL,
  started_at DATETIME,
  completed_at DATETIME,
  max_retries INTEGER,
  error TEXT,
  data TEXT,
  result TEXT,
  scheduled_at DATETIME NOT NULL,
  cron TEXT,
  delete_job_on_completion BOOLEAN DEFAULT FALSE
);

CREATE INDEX IF NOT EXISTS jobs_status_scheduled_at_started_at_idx ON jobs (status, scheduled_at, started_at);
  `.trim();
}

export async function setupSchema({ client, withPragma }: { client: Client; withPragma?: boolean }) {
  await client.executeMultiple(getSchema({ withPragma }));
}
