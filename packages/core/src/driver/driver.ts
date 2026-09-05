import type { Job, SerializedJobError } from '../jobs/job';
import type { Schedule } from '../schedules/schedule';
import type { JsonValue } from '../shared/json';
import type { RetryPolicy } from '../shared/retry';

export type LeaseRef = {
  id: string;
  token: string;
};

export type NewJob = {
  id: string;
  taskName: string;
  payload: JsonValue;
  retry: RetryPolicy;
  availableAt: Temporal.Instant;
  schedule?: {
    id: string;
    occurrenceAt: Temporal.Instant;
  };
};

export type ClaimedJob = Job & {
  status: 'running';
  leaseToken: string;
  leaseExpiresAt: Temporal.Instant;
};

export type ScheduleUpsert = Pick<
  Schedule,
  'id' | 'taskName' | 'payload' | 'retry' | 'trigger' | 'nextRunAt'
>;

export type ClaimedSchedule = Schedule & {
  leaseToken: string;
  leaseExpiresAt: Temporal.Instant;
  claimedAt: Temporal.Instant;
};

export interface Driver {
  readonly name: string;

  initialize(): Promise<void>;
  close(): Promise<void>;
  now(): Promise<Temporal.Instant>;

  insertJob(job: NewJob): Promise<Job>;
  getJob(id: string): Promise<Job | undefined>;

  claimJobs(options: {
    taskNames: ReadonlyArray<string>;
    limit: number;
    leaseDurationMs: number;
  }): Promise<ReadonlyArray<ClaimedJob>>;

  renewJobLeases(options: {
    leases: ReadonlyArray<LeaseRef>;
    leaseDurationMs: number;
  }): Promise<ReadonlyArray<string>>;

  completeJob(lease: LeaseRef): Promise<boolean>;

  retryJob(options: {
    lease: LeaseRef;
    error: SerializedJobError;
    delayMs: number;
  }): Promise<boolean>;

  failJob(options: { lease: LeaseRef; error: SerializedJobError }): Promise<boolean>;

  upsertSchedule(schedule: ScheduleUpsert): Promise<Schedule>;
  getSchedule(id: string): Promise<Schedule | undefined>;
  deleteSchedule(id: string): Promise<boolean>;
  claimDueSchedules(options: {
    limit: number;
    leaseDurationMs: number;
  }): Promise<ReadonlyArray<ClaimedSchedule>>;
  commitScheduleOccurrence(options: {
    lease: LeaseRef;
    job: NewJob;
    nextRunAt: Temporal.Instant;
  }): Promise<boolean>;
  releaseScheduleClaim(lease: LeaseRef): Promise<boolean>;
}
