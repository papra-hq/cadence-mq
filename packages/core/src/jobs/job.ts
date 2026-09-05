import type { JsonValue } from '../shared/json';
import type { RetryPolicy } from '../shared/retry';

export type JobStatus = 'pending' | 'running' | 'succeeded' | 'failed';

export type SerializedJobError = {
  name: string;
  message: string;
  stack?: string;
  code?: string;
};

export type Job<Payload extends JsonValue = JsonValue> = {
  id: string;
  taskName: string;
  payload: Payload;
  status: JobStatus;
  attempts: number;
  retry: RetryPolicy;
  createdAt: Temporal.Instant;
  availableAt: Temporal.Instant;
  startedAt?: Temporal.Instant;
  finishedAt?: Temporal.Instant;
  lastError?: SerializedJobError;
  schedule?: {
    id: string;
    occurrenceAt: Temporal.Instant;
  };
};

export type EnqueueOptions = {
  runAt?: Temporal.InstantLike;
};

export type PruneJobsOptions = {
  /** Only terminal jobs finished strictly before this instant are removed. */
  before: Temporal.InstantLike;
  statuses?: ReadonlyArray<Extract<JobStatus, 'succeeded' | 'failed'>>;
  /** Defaults to 1,000 and cannot exceed 10,000. */
  limit?: number;
};
