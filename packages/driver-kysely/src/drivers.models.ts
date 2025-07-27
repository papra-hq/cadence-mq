import type { Job, JsonSerializable } from '@cadence-mq/core';
import type { JobSelectable } from './database/database.types';

const toPotentialDate = (date: string | null | undefined): Date | undefined => (date ? new Date(date) : undefined);
const toDate = (date: string): Date => new Date(date);
const toJson = (json: string | null | undefined): JsonSerializable | undefined => (json ? JSON.parse(json) : undefined);

export function toJob(row: JobSelectable): Job {
  return {
    id: row.id,
    taskName: row.task_name,
    status: row.status,
    scheduledAt: toDate(row.scheduled_at),
    startedAt: toPotentialDate(row.started_at),
    completedAt: toPotentialDate(row.completed_at),
    maxRetries: row.max_retries ?? undefined,
    data: toJson(row.data),
    result: toJson(row.result),
    error: row.error ?? undefined,
    cron: row.cron ?? undefined,
    createdAt: toDate(row.created_at),
    deleteJobOnCompletion: row.delete_job_on_completion !== undefined ? row.delete_job_on_completion === 1 : undefined,
  };
}
