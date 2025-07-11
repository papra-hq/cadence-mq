import type { Job, JobRepositoryDriver, JobStatus } from '@cadence-mq/core';
import type { Client, Row } from '@libsql/client';
import { DEFAULT_POLL_INTERVAL_MS } from './driver.constants';

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
        WHERE status = 'pending' AND schedule_at <= ?
        ORDER BY schedule_at ASC 
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
    scheduleAt: new Date(row.schedule_at as unknown as string),
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
    saveJob: async ({ job, getNow = () => new Date() }) => {
      await client.batch([{
        sql: 'INSERT INTO jobs (id, task_name, status, created_at, max_retries, data, schedule_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
        args: [job.id, job.taskName, job.status, getNow(), job.maxRetries ?? null, JSON.stringify(job.data), job.scheduleAt],
      }], 'write');
    },
    markJobAsCompleted: async ({ jobId, getNow = () => new Date(), result }) => {
      await client.batch([{
        sql: 'UPDATE jobs SET status = \'completed\', completed_at = ?, result = ? WHERE id = ?',
        args: [getNow(), result ? JSON.stringify(result) : null, jobId],
      }]);
    },
    markJobAsFailed: async ({ jobId, error }) => {
      await client.batch([{
        sql: 'UPDATE jobs SET status = ?, error = ? WHERE id = ?',
        args: ['failed', error, jobId],
      }]);
    },
    getJob: async ({ jobId }) => {
      const { rows } = await client.execute({
        sql: 'SELECT * FROM jobs WHERE id = ?',
        args: [jobId],
      });

      const [jobRow] = rows;

      return { job: jobRow ? toJob(jobRow) : null };
    },
  };
}
