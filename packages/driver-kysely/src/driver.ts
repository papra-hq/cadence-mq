import type { JobRepositoryDriver } from '@cadence-mq/core';
import type { DatabaseClient } from './database/database.types';
import { createJobNotFoundError } from '@cadence-mq/core';
import { sleepMs } from '@cadence-mq/core/utils/time';
import { DEFAULT_POLL_INTERVAL_MS } from './driver.constants';
import { toJob } from './drivers.models';

async function getAndMarkJobAsProcessing({ client }: { client: DatabaseClient }) {
  const rawJob = await client
    .updateTable('jobs')
    .set({
      status: 'processing',
      started_at: new Date().toISOString(),
    })
    .where('status', '=', 'pending')
    .where(({ eb, selectFrom }) =>
      eb(
        'id',
        '=',
        selectFrom('jobs')
          .select('id')
          .where('status', '=', 'pending')
          .where('scheduled_at', '<=', new Date().toISOString())
          .orderBy('scheduled_at', 'asc')
          .limit(1),
      ))
    .returningAll()
    .executeTakeFirst();

  if (!rawJob) {
    return { job: null };
  }

  return { job: toJob(rawJob) };
}

export function createSqlDriver({ client, pollIntervalMs = DEFAULT_POLL_INTERVAL_MS }: { client: DatabaseClient; pollIntervalMs?: number }): JobRepositoryDriver {
  return {
    getNextJobAndMarkAsProcessing: async () => {
      while (true) {
        const { job } = await getAndMarkJobAsProcessing({ client });

        if (!job) {
          await sleepMs(pollIntervalMs);
          continue;
        }

        return { job };
      }
    },
    saveJob: async ({ job }) => {
      await client
        .insertInto('jobs')
        .values({
          id: job.id,
          task_name: job.taskName,
          data: job.data ? JSON.stringify(job.data) : undefined,
          status: job.status,
          error: job.error,
          scheduled_at: job.scheduledAt.toISOString(),
          cron: job.cron,
          max_retries: job.maxRetries,
          created_at: job.createdAt.toISOString(),
          delete_job_on_completion: job.deleteJobOnCompletion ? 1 : 0,
        })
        .execute();
    },
    getJob: async ({ jobId }) => {
      const job = await client
        .selectFrom('jobs')
        .where('id', '=', jobId)
        .selectAll()
        .executeTakeFirst();

      if (!job) {
        return { job: null };
      }

      return { job: toJob(job) };
    },
    getJobCount: async ({ filter = {} } = {}) => {
      let query = client
        .selectFrom('jobs')
        .select(eb => eb.fn.countAll().as('count'));

      if (filter.status) {
        query = query.where('status', '=', filter.status);
      }

      const { count } = await query.executeTakeFirstOrThrow();

      return { count: Number(count) };
    },
    updateJob: async ({ jobId, values }) => {
      await client
        .updateTable('jobs')
        .where('id', '=', jobId)
        .set({
          // :chef-kiss:
          ...(values.result ? { result: JSON.stringify(values.result) } : {}),
          ...(values.error ? { error: values.error } : {}),
          ...(values.data ? { data: JSON.stringify(values.data) } : {}),
          ...(values.scheduledAt ? { scheduled_at: values.scheduledAt.toISOString() } : {}),
          ...(values.startedAt ? { started_at: values.startedAt.toISOString() } : {}),
          ...(values.completedAt ? { completed_at: values.completedAt.toISOString() } : {}),
          ...(values.maxRetries ? { max_retries: values.maxRetries } : {}),
          ...(values.status ? { status: values.status } : {}),
          ...(values.deleteJobOnCompletion !== undefined ? { delete_job_on_completion: values.deleteJobOnCompletion ? 1 : 0 } : {}),
        })
        .execute();
    },
    deleteJob: async ({ jobId }) => {
      const { numDeletedRows } = await client
        .deleteFrom('jobs')
        .where('id', '=', jobId)
        .executeTakeFirst();

      if (numDeletedRows === 0n) {
        throw createJobNotFoundError();
      }
    },
  };
}
