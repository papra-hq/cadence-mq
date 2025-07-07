import type { Job, JobRepositoryDriver, JobStatus } from '@cadence-mq/core';
import type { Client, Row } from '@libsql/client';

async function getAndMarkJobAsProcessing({ client, processingTimeoutMs, now = new Date() }: { client: Client; processingTimeoutMs: number; now?: Date }) {
  const transaction = await client.transaction('write');

  try {
    const expiredAt = new Date(now.getTime() - processingTimeoutMs);

    const { rows } = await transaction.execute({
      sql: 'SELECT * FROM jobs WHERE status = \'pending\' OR (status = \'processing\' AND started_at < ?) ORDER BY schedule_at ASC LIMIT 1',
      args: [expiredAt],
    });

    const [jobRow] = rows;

    if (!jobRow) {
      await transaction.rollback();
      return { job: null };
    }

    await transaction.execute({
      sql: 'UPDATE jobs SET status = \'processing\', started_at = ? WHERE id = ? AND status = \'pending\'',
      args: [now, jobRow.id],
    });

    await transaction.commit();

    return { job: toJob(jobRow) };
  } catch (error) {
    await transaction.rollback();
    throw error;
  }
}

function toJob(row: Row): Job {
  return {
    id: String(row.id),
    taskName: String(row.task_name),
    status: row.status as JobStatus,
    startedAt: row.started_at ? new Date(String(row.started_at)) : undefined,
    completedAt: row.completed_at ? new Date(String(row.completed_at)) : undefined,
    maxRetries: Number(row.max_retries),
    data: row.data ? JSON.parse(String(row.data)) : undefined,
    result: row.result ? JSON.parse(String(row.result)) : undefined,
    scheduleAt: new Date(String(row.schedule_at)),
  };
}

export function createLibSqlDriver({ client, pollIntervalMs = 1000 }: { client: Client; pollIntervalMs?: number }): JobRepositoryDriver {
  return {
    fetchNextJob: async ({ processingTimeoutMs }) => {
      while (true) {
        const { job } = await getAndMarkJobAsProcessing({ client, processingTimeoutMs });

        if (!job) {
          await new Promise(resolve => setTimeout(resolve, pollIntervalMs));
          continue;
        }

        return { job };
      }
    },
    saveJob: async ({ job, now = new Date() }) => {
      await client.batch([{
        sql: 'INSERT INTO jobs (id, task_name, status, created_at, max_retries, data, schedule_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
        args: [job.id, job.taskName, job.status, now, job.maxRetries ?? null, JSON.stringify(job.data), job.scheduleAt],
      }], 'write');
    },
    markJobAsCompleted: async ({ jobId, now = new Date(), result }) => {
      await client.batch([{
        sql: 'UPDATE jobs SET status = \'completed\', completed_at = ?, result = ? WHERE id = ?',
        args: [now, result ? JSON.stringify(result) : null, jobId],
      }], 'write');
    },
    markJobAsFailed: async ({ jobId, error }) => {
      await client.batch([{
        sql: 'UPDATE jobs SET status = ?, error = ? WHERE id = ?',
        args: ['failed', error, jobId],
      }], 'write');
    },
  };
}
