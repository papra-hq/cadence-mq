import type {
  ClaimedJob,
  ClaimedSchedule,
  Clock,
  Driver,
  Job,
  JsonValue,
  LeaseRef,
  NewJob,
  RetryPolicy,
  Schedule,
} from '@cadence-mq/core';
import { randomUUID } from 'node:crypto';
import { CadenceError, systemClock } from '@cadence-mq/core';

type StoredJob = Job & {
  leaseToken?: string;
  leaseExpiresAt?: Temporal.Instant;
};

type StoredSchedule = Schedule & {
  leaseToken?: string;
  leaseExpiresAt?: Temporal.Instant;
};

export type MemoryDriverOptions = {
  clock?: Clock;
};

export function memory({ clock = systemClock }: MemoryDriverOptions = {}): Driver {
  const jobs = new Map<string, StoredJob>();
  const schedules = new Map<string, StoredSchedule>();
  const occurrences = new Set<string>();

  const readNow = (): Temporal.Instant => normalizeInstant(clock.now());

  return {
    name: 'memory',
    initialize: async () => {},
    close: async () => {},
    now: async () => cloneInstant(readNow()),
    insertJob: async (newJob) => {
      if (jobs.has(newJob.id)) {
        throw new CadenceError({
          code: 'job.id-conflict',
          message: `A job with ID ${newJob.id} already exists`,
        });
      }
      const occurrenceKey = getOccurrenceKey(newJob);
      if (occurrenceKey !== undefined && occurrences.has(occurrenceKey)) {
        throw new CadenceError({
          code: 'schedule.occurrence-conflict',
          message: 'A job already exists for this schedule occurrence',
        });
      }

      const job: StoredJob = {
        id: newJob.id,
        taskName: newJob.taskName,
        payload: clonePayload(newJob.payload),
        status: 'pending',
        attempts: 0,
        retry: cloneRetry(newJob.retry),
        createdAt: readNow(),
        availableAt: normalizeInstant(newJob.availableAt),
        ...(newJob.schedule === undefined ? {} : { schedule: cloneSchedule(newJob.schedule) }),
      };

      jobs.set(job.id, job);
      if (occurrenceKey !== undefined) {
        occurrences.add(occurrenceKey);
      }
      return cloneJob(job);
    },
    getJob: async (id) => {
      const job = jobs.get(id);
      return job === undefined ? undefined : cloneJob(job);
    },
    pruneJobs: async ({ before, statuses = ['succeeded', 'failed'], limit = 1_000 }) => {
      assertPruneLimit(limit);
      const acceptedStatuses = normalizePruneStatuses(statuses);
      if (acceptedStatuses.size === 0) {
        return 0;
      }

      const cutoff = normalizeInstant(before);
      const candidates = [...jobs.values()]
        .filter(
          (job) =>
            (job.status === 'succeeded' || job.status === 'failed') &&
            acceptedStatuses.has(job.status) &&
            job.finishedAt !== undefined &&
            Temporal.Instant.compare(job.finishedAt, cutoff) < 0,
        )
        .sort(comparePrunableJobs)
        .slice(0, limit);

      for (const job of candidates) {
        jobs.delete(job.id);
        const occurrenceKey = getOccurrenceKey(job);
        if (occurrenceKey !== undefined) {
          occurrences.delete(occurrenceKey);
        }
      }
      return candidates.length;
    },
    claimJobs: async ({ taskNames, limit, leaseDurationMs }) => {
      assertNonNegativeInteger(limit, 'limit');
      assertNonNegativeInteger(leaseDurationMs, 'leaseDurationMs');

      const now = readNow();
      expireExhaustedJobs(jobs, now);

      if (limit === 0 || taskNames.length === 0) {
        return [];
      }

      const acceptedTaskNames = new Set(taskNames);
      const dueJobs = [...jobs.values()]
        .filter((job) => isClaimable(job, acceptedTaskNames, now))
        .sort(compareJobs)
        .slice(0, limit);

      return dueJobs.map((job) => {
        job.status = 'running';
        job.attempts += 1;
        job.startedAt = now;
        job.finishedAt = undefined;
        job.leaseToken = randomUUID();
        job.leaseExpiresAt = now.add({ milliseconds: leaseDurationMs });
        return cloneClaimedJob(job);
      });
    },
    renewJobLeases: async ({ leases, leaseDurationMs }) => {
      assertNonNegativeInteger(leaseDurationMs, 'leaseDurationMs');

      const now = readNow();
      const renewedIds: string[] = [];
      const visitedIds = new Set<string>();

      for (const { id, token } of leases) {
        if (visitedIds.has(id)) {
          continue;
        }

        const job = jobs.get(id);
        if (
          job?.status !== 'running' ||
          job.leaseToken !== token ||
          job.leaseExpiresAt === undefined ||
          Temporal.Instant.compare(job.leaseExpiresAt, now) <= 0
        ) {
          continue;
        }

        job.leaseExpiresAt = now.add({ milliseconds: leaseDurationMs });
        visitedIds.add(id);
        renewedIds.push(id);
      }

      return renewedIds;
    },
    completeJob: async ({ id, token }: LeaseRef) => {
      const job = jobs.get(id);
      if (!hasLease(job, token)) {
        return false;
      }

      job.status = 'succeeded';
      job.finishedAt = readNow();
      clearLease(job);
      return true;
    },
    retryJob: async ({ lease: { id, token }, error, delayMs }) => {
      assertNonNegativeInteger(delayMs, 'delayMs');

      const job = jobs.get(id);
      if (!hasLease(job, token)) {
        return false;
      }

      const now = readNow();
      job.status = 'pending';
      job.availableAt = now.add({ milliseconds: delayMs });
      job.finishedAt = undefined;
      job.lastError = { ...error };
      clearLease(job);
      return true;
    },
    failJob: async ({ lease: { id, token }, error }) => {
      const job = jobs.get(id);
      if (!hasLease(job, token)) {
        return false;
      }

      job.status = 'failed';
      job.finishedAt = readNow();
      job.lastError = { ...error };
      clearLease(job);
      return true;
    },
    upsertSchedule: async (upsert) => {
      const now = readNow();
      const existing = schedules.get(upsert.id);
      const triggerChanged =
        existing === undefined ||
        existing.trigger.cron !== upsert.trigger.cron ||
        existing.trigger.timeZone !== upsert.trigger.timeZone;
      const schedule: StoredSchedule = {
        id: upsert.id,
        taskName: upsert.taskName,
        payload: clonePayload(upsert.payload),
        retry: cloneRetry(upsert.retry),
        trigger: { ...upsert.trigger },
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
        nextRunAt: triggerChanged ? normalizeInstant(upsert.nextRunAt) : existing.nextRunAt,
        ...(existing?.lastMaterializedAt === undefined
          ? {}
          : { lastMaterializedAt: existing.lastMaterializedAt }),
      };
      schedules.set(schedule.id, schedule);
      return cloneStoredSchedule(schedule);
    },
    getSchedule: async (id) => {
      const schedule = schedules.get(id);
      return schedule === undefined ? undefined : cloneStoredSchedule(schedule);
    },
    deleteSchedule: async (id) => schedules.delete(id),
    claimDueSchedules: async ({ limit, leaseDurationMs }) => {
      assertNonNegativeInteger(limit, 'limit');
      assertNonNegativeInteger(leaseDurationMs, 'leaseDurationMs');
      if (limit === 0) {
        return [];
      }

      const now = readNow();
      return [...schedules.values()]
        .filter(
          (schedule) =>
            Temporal.Instant.compare(schedule.nextRunAt, now) <= 0 &&
            (schedule.leaseExpiresAt === undefined ||
              Temporal.Instant.compare(schedule.leaseExpiresAt, now) <= 0),
        )
        .sort(compareSchedules)
        .slice(0, limit)
        .map((schedule) => {
          schedule.leaseToken = randomUUID();
          schedule.leaseExpiresAt = now.add({ milliseconds: leaseDurationMs });
          return cloneClaimedSchedule(schedule, now);
        });
    },
    commitScheduleOccurrence: async ({ lease: { id, token }, job, nextRunAt }) => {
      const schedule = schedules.get(id);
      if (schedule?.leaseToken !== token) {
        return false;
      }
      if (job.schedule?.id !== id) {
        throw new CadenceError({
          code: 'schedule.invalid-occurrence',
          message: 'The occurrence job does not belong to the claimed schedule',
        });
      }

      const occurrenceKey = getOccurrenceKey(job);
      if (occurrenceKey === undefined) {
        throw new Error('Expected schedule occurrence metadata');
      }
      if (jobs.has(job.id)) {
        throw new CadenceError({
          code: 'job.id-conflict',
          message: `A job with ID ${job.id} already exists`,
        });
      }
      if (occurrences.has(occurrenceKey)) {
        throw new CadenceError({
          code: 'schedule.occurrence-conflict',
          message: 'A job already exists for this schedule occurrence',
        });
      }

      const now = readNow();
      const storedJob = createStoredJob(job, now);
      const materializedAt = normalizeInstant(job.schedule.occurrenceAt);
      const normalizedNextRunAt = normalizeInstant(nextRunAt);

      jobs.set(storedJob.id, storedJob);
      occurrences.add(occurrenceKey);
      schedule.lastMaterializedAt = materializedAt;
      schedule.nextRunAt = normalizedNextRunAt;
      schedule.updatedAt = now;
      clearScheduleLease(schedule);
      return true;
    },
    releaseScheduleClaim: async ({ id, token }) => {
      const schedule = schedules.get(id);
      if (schedule?.leaseToken !== token) {
        return false;
      }
      clearScheduleLease(schedule);
      return true;
    },
  };
}

export const createMemoryDriver: typeof memory = memory;

function getOccurrenceKey(job: NewJob): string | undefined {
  return job.schedule === undefined
    ? undefined
    : `${job.schedule.id}\u0000${job.schedule.occurrenceAt.epochMilliseconds}`;
}

function createStoredJob(newJob: NewJob, now: Temporal.Instant): StoredJob {
  return {
    id: newJob.id,
    taskName: newJob.taskName,
    payload: clonePayload(newJob.payload),
    status: 'pending',
    attempts: 0,
    retry: cloneRetry(newJob.retry),
    createdAt: now,
    availableAt: normalizeInstant(newJob.availableAt),
    ...(newJob.schedule === undefined ? {} : { schedule: cloneSchedule(newJob.schedule) }),
  };
}

function hasLease(job: StoredJob | undefined, token: string): job is StoredJob {
  return job?.status === 'running' && job.leaseToken === token;
}

function clearLease(job: StoredJob): void {
  job.leaseToken = undefined;
  job.leaseExpiresAt = undefined;
}

function isClaimable(
  job: StoredJob,
  taskNames: ReadonlySet<string>,
  now: Temporal.Instant,
): boolean {
  if (!taskNames.has(job.taskName)) {
    return false;
  }

  if (job.status === 'pending') {
    return Temporal.Instant.compare(job.availableAt, now) <= 0;
  }

  return (
    job.status === 'running' &&
    job.leaseExpiresAt !== undefined &&
    Temporal.Instant.compare(job.leaseExpiresAt, now) <= 0 &&
    job.attempts < job.retry.maxAttempts
  );
}

function expireExhaustedJobs(jobs: Map<string, StoredJob>, now: Temporal.Instant): void {
  for (const job of jobs.values()) {
    if (
      job.status === 'running' &&
      job.leaseExpiresAt !== undefined &&
      Temporal.Instant.compare(job.leaseExpiresAt, now) <= 0 &&
      job.attempts >= job.retry.maxAttempts
    ) {
      job.status = 'failed';
      job.finishedAt = now;
      job.lastError = {
        name: 'CadenceError',
        message: 'The final job lease expired',
        code: 'job.lease-expired',
      };
      clearLease(job);
    }
  }
}

function compareJobs(left: StoredJob, right: StoredJob): number {
  const availability = Temporal.Instant.compare(left.availableAt, right.availableAt);
  if (availability !== 0) {
    return availability;
  }

  const creation = Temporal.Instant.compare(left.createdAt, right.createdAt);
  return creation === 0 ? left.id.localeCompare(right.id) : creation;
}

function comparePrunableJobs(left: StoredJob, right: StoredJob): number {
  if (left.finishedAt === undefined || right.finishedAt === undefined) {
    throw new Error('Cannot compare jobs without a finish time');
  }

  const finished = Temporal.Instant.compare(left.finishedAt, right.finishedAt);
  return finished === 0 ? left.id.localeCompare(right.id) : finished;
}

function cloneJob(job: StoredJob): Job {
  return {
    id: job.id,
    taskName: job.taskName,
    payload: clonePayload(job.payload),
    status: job.status,
    attempts: job.attempts,
    retry: cloneRetry(job.retry),
    createdAt: cloneInstant(job.createdAt),
    availableAt: cloneInstant(job.availableAt),
    ...(job.startedAt === undefined ? {} : { startedAt: cloneInstant(job.startedAt) }),
    ...(job.finishedAt === undefined ? {} : { finishedAt: cloneInstant(job.finishedAt) }),
    ...(job.lastError === undefined ? {} : { lastError: { ...job.lastError } }),
    ...(job.schedule === undefined ? {} : { schedule: cloneSchedule(job.schedule) }),
  };
}

function cloneStoredSchedule(schedule: StoredSchedule): Schedule {
  return {
    id: schedule.id,
    taskName: schedule.taskName,
    payload: clonePayload(schedule.payload),
    retry: cloneRetry(schedule.retry),
    trigger: { ...schedule.trigger },
    createdAt: cloneInstant(schedule.createdAt),
    updatedAt: cloneInstant(schedule.updatedAt),
    nextRunAt: cloneInstant(schedule.nextRunAt),
    ...(schedule.lastMaterializedAt === undefined
      ? {}
      : { lastMaterializedAt: cloneInstant(schedule.lastMaterializedAt) }),
  };
}

function cloneClaimedSchedule(
  schedule: StoredSchedule,
  claimedAt: Temporal.Instant,
): ClaimedSchedule {
  if (schedule.leaseToken === undefined || schedule.leaseExpiresAt === undefined) {
    throw new Error('Cannot clone a schedule without an active lease');
  }
  return {
    ...cloneStoredSchedule(schedule),
    leaseToken: schedule.leaseToken,
    leaseExpiresAt: cloneInstant(schedule.leaseExpiresAt),
    claimedAt: cloneInstant(claimedAt),
  };
}

function clearScheduleLease(schedule: StoredSchedule): void {
  schedule.leaseToken = undefined;
  schedule.leaseExpiresAt = undefined;
}

function compareSchedules(left: StoredSchedule, right: StoredSchedule): number {
  const nextRun = Temporal.Instant.compare(left.nextRunAt, right.nextRunAt);
  return nextRun === 0 ? left.id.localeCompare(right.id) : nextRun;
}

function cloneClaimedJob(job: StoredJob): ClaimedJob {
  if (
    job.status !== 'running' ||
    job.leaseToken === undefined ||
    job.leaseExpiresAt === undefined
  ) {
    throw new Error('Cannot clone a job without an active lease');
  }

  return {
    ...cloneJob(job),
    status: 'running',
    leaseToken: job.leaseToken,
    leaseExpiresAt: cloneInstant(job.leaseExpiresAt),
  };
}

function clonePayload<Payload extends JsonValue>(payload: Payload): Payload {
  return structuredClone(payload);
}

function cloneRetry(retry: RetryPolicy): RetryPolicy {
  return retry.backoff === undefined
    ? { maxAttempts: retry.maxAttempts }
    : { maxAttempts: retry.maxAttempts, backoff: { ...retry.backoff } };
}

function cloneSchedule(schedule: NonNullable<NewJob['schedule']>): NonNullable<Job['schedule']> {
  return {
    id: schedule.id,
    occurrenceAt: cloneInstant(schedule.occurrenceAt),
  };
}

function cloneInstant(instant: Temporal.Instant): Temporal.Instant {
  return Temporal.Instant.fromEpochMilliseconds(instant.epochMilliseconds);
}

function normalizeInstant(instant: Temporal.InstantLike): Temporal.Instant {
  return cloneInstant(Temporal.Instant.from(instant));
}

function normalizePruneStatuses(
  statuses: ReadonlyArray<'succeeded' | 'failed'>,
): ReadonlySet<'succeeded' | 'failed'> {
  if (statuses.some((status) => status !== 'succeeded' && status !== 'failed')) {
    throw new CadenceError({
      code: 'driver.invalid-options',
      message: 'statuses may only contain succeeded and failed',
    });
  }
  return new Set(statuses);
}

function assertPruneLimit(limit: number): void {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 10_000) {
    throw new CadenceError({
      code: 'driver.invalid-options',
      message: 'limit must be an integer between 1 and 10,000',
    });
  }
}

function assertNonNegativeInteger(value: number, field: string): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new CadenceError({
      code: 'driver.invalid-options',
      message: `${field} must be a non-negative integer`,
    });
  }
}
