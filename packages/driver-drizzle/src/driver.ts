import type { Job, JobRepositoryDriver } from '@cadence-mq/core';
import { createJobNotFoundError } from '@cadence-mq/core';
import { sleepMs } from '@cadence-mq/core/utils/time';

import { and, asc, count, eq, lte } from 'drizzle-orm';
import { DEFAULT_POLL_INTERVAL_MS } from './driver.constants';

type DB = any;
type Table = any;
type Schema = {
  jobs?: Table;
};

async function getAndMarkJobAsProcessing({ db, jobsTable, now = new Date() }: { db: DB; jobsTable: Table; now?: Date }) {
  const [job] = await db
    .update(jobsTable)
    .set({ status: 'processing', startedAt: now })
    .where(
      and(
        eq(jobsTable.status, 'pending'),
        eq(
          jobsTable.id,
          db
            .select({ id: jobsTable.id })
            .from(jobsTable)
            .where(
              and(
                eq(jobsTable.status, 'pending'),
                lte(jobsTable.scheduledAt, now),
              ),
            )
            .orderBy(asc(jobsTable.scheduledAt))
            .limit(1),
        ),
      ),
    )
    .returning();

  return { job };
}

function toJob(job: any): Job {
  const jobsWithNulls = {
    ...job,
    data: job.data ? JSON.parse(job.data) : undefined,
    result: job.result ? JSON.parse(job.result) : undefined,
    deleteJobOnCompletion: job.deleteJobOnCompletion !== undefined ? Boolean(job.deleteJobOnCompletion) : false,
  };

  return Object.fromEntries(Object.entries(jobsWithNulls).map(([key, value]) => [key, value ?? undefined])) as Job;
}

export function createDrizzleDriver({ db, pollIntervalMs = DEFAULT_POLL_INTERVAL_MS, schema }: { db: DB; pollIntervalMs?: number; schema?: Schema }): JobRepositoryDriver {
  const jobsTable: Table = schema?.jobs ?? db?._?.fullSchema?.jobs;

  if (!jobsTable) {
    throw new Error('Jobs table not found, please ensure the schema is setup correctly');
  }

  return {
    getNextJobAndMarkAsProcessing: async () => {
      while (true) {
        const { job } = await getAndMarkJobAsProcessing({ db, jobsTable });

        if (!job) {
          await sleepMs(pollIntervalMs);
          continue;
        }

        return { job: toJob(job) };
      }
    },
    saveJob: async ({ job }) => {
      await db.insert(jobsTable).values({
        ...job,
        data: job.data ? JSON.stringify(job.data) : null,
      });
    },
    getJob: async ({ jobId }) => {
      const [job] = await db.select().from(jobsTable).where(eq(jobsTable.id, jobId));

      if (!job) {
        return { job: null };
      }

      return { job: toJob(job) };
    },
    getJobCount: async ({ filter = {} } = {}) => {
      const where = Object.entries(filter).map(([key, value]) => eq(jobsTable[key], value));

      const result = await db
        .select({ count: count() })
        .from(jobsTable)
        .where(where.length > 0 ? and(...where) : undefined);

      return { count: Number(result[0]?.count ?? 0) };
    },
    updateJob: async ({ jobId, values }) => {
      const formattedValues = {
        ...(values.result ? { result: JSON.stringify(values.result) } : {}),
        ...(values.error ? { error: values.error } : {}),
        ...(values.data ? { data: JSON.stringify(values.data) } : {}),
        ...(values.scheduledAt ? { scheduledAt: values.scheduledAt } : {}),
        ...(values.startedAt ? { startedAt: values.startedAt } : {}),
        ...(values.completedAt ? { completedAt: values.completedAt } : {}),
        ...(values.maxRetries ? { maxRetries: values.maxRetries } : {}),
        ...(values.status ? { status: values.status } : {}),
        ...(values.deleteJobOnCompletion !== undefined ? { deleteJobOnCompletion: values.deleteJobOnCompletion } : {}),
      };

      await db
        .update(jobsTable)
        .set(formattedValues)
        .where(eq(jobsTable.id, jobId));
    },
    deleteJob: async ({ jobId }) => {
      const result = await db
        .delete(jobsTable)
        .where(eq(jobsTable.id, jobId))
        .returning();

      if (result.length === 0) {
        throw createJobNotFoundError();
      }
    },
  };
}
