import type {
  ClaimedJob,
  Clock,
  Driver,
  Job,
  JsonValue,
  LeaseRef,
  NewJob,
  RetryPolicy,
} from '@cadence-mq/core';
import { randomUUID } from 'node:crypto';
import { CadenceError, systemClock } from '@cadence-mq/core';

type StoredJob = Job & {
  leaseToken?: string;
  leaseExpiresAt?: Temporal.Instant;
};

export type MemoryDriverOptions = {
  clock?: Clock;
};

export function memory({ clock = systemClock }: MemoryDriverOptions = {}): Driver {
  const jobs = new Map<string, StoredJob>();

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
      return cloneJob(job);
    },
    getJob: async (id) => {
      const job = jobs.get(id);
      return job === undefined ? undefined : cloneJob(job);
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
  };
}

export const createMemoryDriver: typeof memory = memory;

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

function assertNonNegativeInteger(value: number, field: string): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new CadenceError({
      code: 'driver.invalid-options',
      message: `${field} must be a non-negative integer`,
    });
  }
}
