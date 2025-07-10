import type { Client } from '@libsql/client';

export function getSchema() {
  return `
PRAGMA journal_mode = WAL;
PRAGMA synchronous = 1;
PRAGMA busy_timeout = 5000;

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
  schedule_at DATETIME NOT NULL
);

CREATE INDEX IF NOT EXISTS jobs_status_schedule_at_started_at_idx ON jobs (status, schedule_at, started_at);
  `.trim();
}

export async function setupSchema({ client }: { client: Client }) {
  await client.executeMultiple(getSchema());
}
