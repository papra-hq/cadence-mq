import type { Job, JobRepositoryDriver, JobStatus } from '@cadence-mq/core';
import type { Client, Row } from '@libsql/client';
import { DEFAULT_POLL_INTERVAL_MS } from './driver.constants';
import { buildUpdateJobSetClause } from './driver.models';

async function getAndMarkJobAsProcessing({ client, now = new Date() }: { client: Client; now?: Date }) {
  // Use a single UPDATE statement to atomically select and update a job
  // This prevents long-running transactions that can lock the database
  const { rows } = await client.execute({
    sql: `
      UPDATE jobs 
      SET status = 'processing', started_at = ? 
      WHERE id = (
        SELECT id 
        FROM jobs 
        WHERE status = 'pending' AND scheduled_at <= ?
        ORDER BY scheduled_at ASC 
        LIMIT 1
      ) AND status = 'pending'
      RETURNING *
    `,
    args: [now, now],
  });

  const [jobRow] = rows;

  if (!jobRow) {
    return { job: null };
  }

  return { job: toJob(jobRow) };
}

function toJob(row: Row): Job {
  return {
    id: String(row.id),
    taskName: String(row.task_name),
    status: row.status as JobStatus,
    startedAt: row.started_at ? new Date(row.started_at as unknown as string) : undefined,
    completedAt: row.completed_at ? new Date(row.completed_at as unknown as string) : undefined,
    maxRetries: row.max_retries ? Number(row.max_retries) : undefined,
    data: row.data ? JSON.parse(String(row.data)) : undefined,
    result: row.result ? JSON.parse(String(row.result)) : undefined,
    error: row.error ? String(row.error) : undefined,
    cron: row.cron ? String(row.cron) : undefined,
    scheduledAt: new Date(row.scheduled_at as unknown as string),
  };
}

export function createLibSqlDriver({ client, pollIntervalMs = DEFAULT_POLL_INTERVAL_MS }: { client: Client; pollIntervalMs?: number }): JobRepositoryDriver {
  return {
    getNextJobAndMarkAsProcessing: async () => {
      while (true) {
        const { job } = await getAndMarkJobAsProcessing({ client });

        if (!job) {
          await new Promise(resolve => setTimeout(resolve, pollIntervalMs));
          continue;
        }

        return { job };
      }
    },
    saveJob: async ({ job, now = new Date() }) => {
      await client.batch([{
        sql: 'INSERT INTO jobs (id, task_name, status, created_at, max_retries, data, scheduled_at, cron) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        args: [job.id, job.taskName, job.status, now, job.maxRetries ?? null, JSON.stringify(job.data), job.scheduledAt, job.cron ?? null],
      }], 'write');
    },
    getJob: async ({ jobId }) => {
      const { rows } = await client.execute({
        sql: 'SELECT * FROM jobs WHERE id = ?',
        args: [jobId],
      });

      const [jobRow] = rows;

      return { job: jobRow ? toJob(jobRow) : null };
    },
    getJobCount: async ({ filter = {} } = {}) => {
      const fields = { status: 'status' };
      const filterEntries = Object.entries(filter);

      // TODO: extract the filter builder to a separate testable function
      // The building of the where is safe as the fields are not user-controlled
      const whereClause = filterEntries.map(([key]) => `${fields[key]} = ?`).join(' AND ');

      const { rows } = await client.execute({
        sql: `SELECT COUNT(*) AS count FROM jobs ${whereClause ? `WHERE ${whereClause}` : ''}`,
        args: filterEntries.map(([, value]) => String(value)),
      });

      const [{ count } = { count: 0 }] = rows ?? [];

      return { count: Number(count) };
    },
    updateJob: async ({ jobId, values }) => {
      const { setClause, args } = buildUpdateJobSetClause({ values });

      await client.batch([{
        sql: `UPDATE jobs SET ${setClause} WHERE id = ?`,
        args: [...args, jobId],
      }]);
    },
  };
}
