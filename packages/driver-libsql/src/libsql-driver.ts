import type {
  ClaimedJob,
  ClaimedSchedule,
  Driver,
  Job,
  JobStatus,
  JsonValue,
  LeaseRef,
  NewJob,
  RetryPolicy,
  Schedule,
  SerializedJobError,
} from '@cadence-mq/core';
import type { Client, Config, Row } from '@libsql/client';
import { CadenceError, isCadenceError } from '@cadence-mq/core';
import { createClient } from '@libsql/client';
import { databaseNowExpression, migrate } from './migrations';

export type LibsqlOptions = Config;

export function libsql(options: LibsqlOptions): Driver {
  return createLibsqlDriver({ client: createClient({ timeout: 5_000, ...options }) });
}

export function createLibsqlDriver({ client }: { client: Client }): Driver {
  const nowExpression = databaseNowExpression();
  let closePromise: Promise<void> | undefined;

  return {
    name: 'libsql',
    initialize: async () => withDriverError('initialize', async () => migrate(client)),
    close: async () => {
      closePromise ??= withDriverError('close', async () => client.close());
      return closePromise;
    },
    now: async () =>
      withDriverError('now', async () => {
        const result = await client.execute(`SELECT ${nowExpression} AS now_ms`);
        return toInstant(requiredRow(result.rows[0], 'now').now_ms);
      }),
    insertJob: async (job) =>
      withDriverError('insert-job', async () => {
        const result = await client.execute({
          sql: `
            INSERT INTO cadence_jobs (
              id,
              task_name,
              payload,
              status,
              attempts,
              retry_json,
              max_attempts,
              created_at,
              available_at,
              schedule_id,
              schedule_occurrence_at
            ) VALUES (?, ?, ?, 'pending', 0, ?, ?, ${nowExpression}, ?, ?, ?)
            RETURNING *
          `,
          args: [
            job.id,
            job.taskName,
            JSON.stringify(job.payload),
            JSON.stringify(job.retry),
            job.retry.maxAttempts,
            job.availableAt.epochMilliseconds,
            job.schedule?.id ?? null,
            job.schedule?.occurrenceAt.epochMilliseconds ?? null,
          ],
        });

        return toJob(requiredRow(result.rows[0], 'inserted job'));
      }),
    getJob: async (id) =>
      withDriverError('get-job', async () => {
        const result = await client.execute({
          sql: 'SELECT * FROM cadence_jobs WHERE id = ?',
          args: [id],
        });
        const [row] = result.rows;
        return row === undefined ? undefined : toJob(row);
      }),
    claimJobs: async ({ taskNames, limit, leaseDurationMs }) =>
      withDriverError('claim-jobs', async () => {
        assertNonNegativeInteger(limit, 'limit');
        assertNonNegativeInteger(leaseDurationMs, 'leaseDurationMs');

        const expireStatement = {
          sql: `
            UPDATE cadence_jobs
            SET
              status = 'failed',
              finished_at = ${nowExpression},
              last_error = ?,
              lease_token = NULL,
              lease_expires_at = NULL
            WHERE
              status = 'running'
              AND lease_expires_at <= ${nowExpression}
              AND attempts >= max_attempts
          `,
          args: [
            JSON.stringify({
              name: 'CadenceError',
              message: 'The final job lease expired',
              code: 'job.lease-expired',
            } satisfies SerializedJobError),
          ],
        };

        if (limit === 0 || taskNames.length === 0) {
          await client.execute(expireStatement);
          return [];
        }

        const taskPlaceholders = taskNames.map(() => '?').join(', ');
        const claimStatement = {
          sql: `
            WITH candidates AS MATERIALIZED (
              SELECT id
              FROM cadence_jobs
              WHERE
                task_name IN (${taskPlaceholders})
                AND (
                  (status = 'pending' AND available_at <= ${nowExpression})
                  OR (
                    status = 'running'
                    AND lease_expires_at <= ${nowExpression}
                    AND attempts < max_attempts
                  )
                )
              ORDER BY available_at, created_at, id
              LIMIT ?
            )
            UPDATE cadence_jobs
            SET
              status = 'running',
              attempts = attempts + 1,
              started_at = ${nowExpression},
              finished_at = NULL,
              lease_token = lower(hex(randomblob(16))),
              lease_expires_at = ${nowExpression} + ?
            WHERE id IN (SELECT id FROM candidates)
            RETURNING *
          `,
          args: [...taskNames, limit, leaseDurationMs],
        };

        const [, claimResult] = await client.batch([expireStatement, claimStatement], 'write');
        if (claimResult === undefined) {
          throw new Error('LibSQL did not return a claim result');
        }

        return claimResult.rows.map(toClaimedJob).sort(compareClaimedJobs);
      }),
    renewJobLeases: async ({ leases, leaseDurationMs }) =>
      withDriverError('renew-job-leases', async () => {
        assertNonNegativeInteger(leaseDurationMs, 'leaseDurationMs');
        if (leases.length === 0) {
          return [];
        }

        const leasePredicates = leases.map(() => '(id = ? AND lease_token = ?)').join(' OR ');
        const result = await client.execute({
          sql: `
            UPDATE cadence_jobs
            SET lease_expires_at = ${nowExpression} + ?
            WHERE
              status = 'running'
              AND lease_expires_at > ${nowExpression}
              AND (${leasePredicates})
            RETURNING id
          `,
          args: [leaseDurationMs, ...leases.flatMap(({ id, token }) => [id, token])],
        });
        const renewedIds = new Set(result.rows.map((row) => requiredString(row.id, 'id')));
        return leases
          .map(({ id }) => id)
          .filter((id, index, ids) => renewedIds.has(id) && ids.indexOf(id) === index);
      }),
    completeJob: async ({ id, token }: LeaseRef) =>
      withDriverError('complete-job', async () => {
        const result = await client.execute({
          sql: `
            UPDATE cadence_jobs
            SET
              status = 'succeeded',
              finished_at = ${nowExpression},
              lease_token = NULL,
              lease_expires_at = NULL
            WHERE id = ? AND status = 'running' AND lease_token = ?
          `,
          args: [id, token],
        });
        return result.rowsAffected === 1;
      }),
    retryJob: async ({ lease: { id, token }, error, delayMs }) =>
      withDriverError('retry-job', async () => {
        assertNonNegativeInteger(delayMs, 'delayMs');
        const result = await client.execute({
          sql: `
            UPDATE cadence_jobs
            SET
              status = 'pending',
              available_at = ${nowExpression} + ?,
              finished_at = NULL,
              last_error = ?,
              lease_token = NULL,
              lease_expires_at = NULL
            WHERE id = ? AND status = 'running' AND lease_token = ?
          `,
          args: [delayMs, JSON.stringify(error), id, token],
        });
        return result.rowsAffected === 1;
      }),
    failJob: async ({ lease: { id, token }, error }) =>
      withDriverError('fail-job', async () => {
        const result = await client.execute({
          sql: `
            UPDATE cadence_jobs
            SET
              status = 'failed',
              finished_at = ${nowExpression},
              last_error = ?,
              lease_token = NULL,
              lease_expires_at = NULL
            WHERE id = ? AND status = 'running' AND lease_token = ?
          `,
          args: [JSON.stringify(error), id, token],
        });
        return result.rowsAffected === 1;
      }),
    upsertSchedule: async (schedule) =>
      withDriverError('upsert-schedule', async () => {
        const result = await client.execute({
          sql: `
            INSERT INTO cadence_schedules (
              id, task_name, payload, retry_json, cron, time_zone,
              created_at, updated_at, next_run_at
            ) VALUES (?, ?, ?, ?, ?, ?, ${nowExpression}, ${nowExpression}, ?)
            ON CONFLICT(id) DO UPDATE SET
              task_name = excluded.task_name,
              payload = excluded.payload,
              retry_json = excluded.retry_json,
              next_run_at = CASE
                WHEN cadence_schedules.cron = excluded.cron
                  AND cadence_schedules.time_zone = excluded.time_zone
                THEN cadence_schedules.next_run_at
                ELSE excluded.next_run_at
              END,
              cron = excluded.cron,
              time_zone = excluded.time_zone,
              updated_at = ${nowExpression},
              lease_token = NULL,
              lease_expires_at = NULL
            RETURNING *
          `,
          args: [
            schedule.id,
            schedule.taskName,
            JSON.stringify(schedule.payload),
            JSON.stringify(schedule.retry),
            schedule.trigger.cron,
            schedule.trigger.timeZone,
            schedule.nextRunAt.epochMilliseconds,
          ],
        });
        return toSchedule(requiredRow(result.rows[0], 'upserted schedule'));
      }),
    getSchedule: async (id) =>
      withDriverError('get-schedule', async () => {
        const result = await client.execute({
          sql: 'SELECT * FROM cadence_schedules WHERE id = ?',
          args: [id],
        });
        const [row] = result.rows;
        return row === undefined ? undefined : toSchedule(row);
      }),
    deleteSchedule: async (id) =>
      withDriverError('delete-schedule', async () => {
        const result = await client.execute({
          sql: 'DELETE FROM cadence_schedules WHERE id = ?',
          args: [id],
        });
        return result.rowsAffected === 1;
      }),
    claimDueSchedules: async ({ limit, leaseDurationMs }) =>
      withDriverError('claim-due-schedules', async () => {
        assertNonNegativeInteger(limit, 'limit');
        assertNonNegativeInteger(leaseDurationMs, 'leaseDurationMs');
        if (limit === 0) {
          return [];
        }

        const result = await client.execute({
          sql: `
            WITH candidates AS MATERIALIZED (
              SELECT id
              FROM cadence_schedules
              WHERE next_run_at <= ${nowExpression}
                AND (lease_token IS NULL OR lease_expires_at <= ${nowExpression})
              ORDER BY next_run_at, id
              LIMIT ?
            )
            UPDATE cadence_schedules
            SET
              lease_token = lower(hex(randomblob(16))),
              lease_expires_at = ${nowExpression} + ?
            WHERE id IN (SELECT id FROM candidates)
            RETURNING *, ${nowExpression} AS claimed_at
          `,
          args: [limit, leaseDurationMs],
        });
        return result.rows.map(toClaimedSchedule).sort(compareClaimedSchedules);
      }),
    commitScheduleOccurrence: async ({ lease: { id, token }, job, nextRunAt }) =>
      withDriverError('commit-schedule-occurrence', async () => {
        if (job.schedule?.id !== id) {
          throw new CadenceError({
            code: 'schedule.invalid-occurrence',
            message: 'The occurrence job does not belong to the claimed schedule',
          });
        }

        const [, update] = await client.batch(
          [
            insertScheduleOccurrenceStatement(job, nowExpression, { id, token }),
            {
              sql: `
                UPDATE cadence_schedules
                SET
                  next_run_at = ?,
                  last_materialized_at = ?,
                  updated_at = ${nowExpression},
                  lease_token = NULL,
                  lease_expires_at = NULL
                WHERE id = ? AND lease_token = ?
              `,
              args: [
                nextRunAt.epochMilliseconds,
                job.schedule.occurrenceAt.epochMilliseconds,
                id,
                token,
              ],
            },
          ],
          'write',
        );
        if (update === undefined) {
          throw new Error('LibSQL did not return a schedule update result');
        }
        return update.rowsAffected === 1;
      }),
    releaseScheduleClaim: async ({ id, token }) =>
      withDriverError('release-schedule-claim', async () => {
        const result = await client.execute({
          sql: `
            UPDATE cadence_schedules
            SET lease_token = NULL, lease_expires_at = NULL
            WHERE id = ? AND lease_token = ?
          `,
          args: [id, token],
        });
        return result.rowsAffected === 1;
      }),
  };
}

export const createLibSqlDriver: typeof createLibsqlDriver = createLibsqlDriver;

function insertScheduleOccurrenceStatement(job: NewJob, nowExpression: string, lease: LeaseRef) {
  return {
    sql: `
      INSERT INTO cadence_jobs (
        id, task_name, payload, status, attempts, retry_json, max_attempts,
        created_at, available_at, schedule_id, schedule_occurrence_at
      )
      SELECT ?, ?, ?, 'pending', 0, ?, ?, ${nowExpression}, ?, ?, ?
      WHERE EXISTS (
        SELECT 1 FROM cadence_schedules WHERE id = ? AND lease_token = ?
      )
    `,
    args: [
      job.id,
      job.taskName,
      JSON.stringify(job.payload),
      JSON.stringify(job.retry),
      job.retry.maxAttempts,
      job.availableAt.epochMilliseconds,
      job.schedule?.id ?? null,
      job.schedule?.occurrenceAt.epochMilliseconds ?? null,
      lease.id,
      lease.token,
    ],
  };
}

function toSchedule(row: Row): Schedule {
  return {
    id: requiredString(row.id, 'id'),
    taskName: requiredString(row.task_name, 'task_name'),
    payload: parseJson<JsonValue>(row.payload, 'payload'),
    retry: parseJson<RetryPolicy>(row.retry_json, 'retry_json'),
    trigger: {
      cron: requiredString(row.cron, 'cron'),
      timeZone: requiredString(row.time_zone, 'time_zone'),
    },
    createdAt: toInstant(row.created_at),
    updatedAt: toInstant(row.updated_at),
    nextRunAt: toInstant(row.next_run_at),
    ...(row.last_materialized_at === null
      ? {}
      : { lastMaterializedAt: toInstant(row.last_materialized_at) }),
  };
}

function toClaimedSchedule(row: Row): ClaimedSchedule {
  return {
    ...toSchedule(row),
    leaseToken: requiredString(row.lease_token, 'lease_token'),
    leaseExpiresAt: toInstant(row.lease_expires_at),
    claimedAt: toInstant(row.claimed_at),
  };
}

function compareClaimedSchedules(left: ClaimedSchedule, right: ClaimedSchedule): number {
  const nextRun = Temporal.Instant.compare(left.nextRunAt, right.nextRunAt);
  return nextRun === 0 ? left.id.localeCompare(right.id) : nextRun;
}

function toJob(row: Row): Job {
  const status = toStatus(row.status);
  const scheduleId = optionalString(row.schedule_id);
  const scheduleOccurrenceAt = optionalInstant(row.schedule_occurrence_at);

  return {
    id: requiredString(row.id, 'id'),
    taskName: requiredString(row.task_name, 'task_name'),
    payload: parseJson<JsonValue>(row.payload, 'payload'),
    status,
    attempts: requiredNumber(row.attempts, 'attempts'),
    retry: parseJson<RetryPolicy>(row.retry_json, 'retry_json'),
    createdAt: toInstant(row.created_at),
    availableAt: toInstant(row.available_at),
    ...(row.started_at === null ? {} : { startedAt: toInstant(row.started_at) }),
    ...(row.finished_at === null ? {} : { finishedAt: toInstant(row.finished_at) }),
    ...(row.last_error === null
      ? {}
      : { lastError: parseJson<SerializedJobError>(row.last_error, 'last_error') }),
    ...(scheduleId === undefined || scheduleOccurrenceAt === undefined
      ? {}
      : { schedule: { id: scheduleId, occurrenceAt: scheduleOccurrenceAt } }),
  };
}

function toClaimedJob(row: Row): ClaimedJob {
  const job = toJob(row);
  if (job.status !== 'running') {
    throw new Error(`Expected a running job, received ${job.status}`);
  }

  return {
    ...job,
    status: 'running',
    leaseToken: requiredString(row.lease_token, 'lease_token'),
    leaseExpiresAt: toInstant(row.lease_expires_at),
  };
}

function compareClaimedJobs(left: ClaimedJob, right: ClaimedJob): number {
  const availability = Temporal.Instant.compare(left.availableAt, right.availableAt);
  if (availability !== 0) {
    return availability;
  }

  const creation = Temporal.Instant.compare(left.createdAt, right.createdAt);
  return creation === 0 ? left.id.localeCompare(right.id) : creation;
}

function toStatus(value: Row[string] | undefined): JobStatus {
  if (value === 'pending' || value === 'running' || value === 'succeeded' || value === 'failed') {
    return value;
  }
  throw new Error(`Invalid job status type: ${typeof value}`);
}

function toInstant(value: Row[string] | undefined): Temporal.Instant {
  return Temporal.Instant.fromEpochMilliseconds(requiredNumber(value, 'instant'));
}

function optionalInstant(value: Row[string] | undefined): Temporal.Instant | undefined {
  return value === null ? undefined : toInstant(value);
}

function requiredNumber(value: Row[string] | undefined, field: string): number {
  if (typeof value === 'number') {
    return value;
  }
  if (typeof value === 'bigint' || typeof value === 'string') {
    const number = Number(value);
    if (Number.isSafeInteger(number)) {
      return number;
    }
  }
  throw new Error(`Expected ${field} to be a safe integer`);
}

function requiredString(value: Row[string] | undefined, field: string): string {
  if (typeof value !== 'string') {
    throw new Error(`Expected ${field} to be a string`);
  }
  return value;
}

function optionalString(value: Row[string] | undefined): string | undefined {
  return value === null ? undefined : requiredString(value, 'string');
}

function parseJson<Value>(value: Row[string] | undefined, field: string): Value {
  return JSON.parse(requiredString(value, field)) as Value;
}

function requiredRow(row: Row | undefined, description: string): Row {
  if (row === undefined) {
    throw new Error(`LibSQL did not return ${description}`);
  }
  return row;
}

function assertNonNegativeInteger(value: number, field: string): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new CadenceError({
      code: 'driver.invalid-options',
      message: `${field} must be a non-negative integer`,
    });
  }
}

async function withDriverError<Value>(
  operation: string,
  run: () => Promise<Value>,
): Promise<Value> {
  try {
    return await run();
  } catch (cause) {
    if (isCadenceError(cause)) {
      throw cause;
    }
    throw new CadenceError({
      code: `driver.libsql.${operation}`,
      message: `LibSQL ${operation} operation failed`,
      cause,
    });
  }
}
