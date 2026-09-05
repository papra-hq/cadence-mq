import type { Driver } from '../driver/driver';
import type { EnqueueOptions, Job, JobStatus, PruneJobsOptions } from '../jobs/job';
import type { Schedule, ScheduleClient } from '../schedules/schedule';
import type { JsonValue } from '../shared/json';
import type { TaskDefinition } from '../tasks/task-definition';
import type { StopWorkerOptions, Worker, WorkerOptions } from '../workers/worker';
import { randomUUID } from 'node:crypto';
import { createError } from '../../errors/errors.models';
import { getNextExecutionDate } from '../cron/cron';
import { assertScheduleId } from '../schedules/schedule';
import { cloneJsonValue } from '../shared/json';
import { cloneRetryPolicy } from '../shared/retry';
import { normalizeInstant } from '../shared/instant';
import { validatePayload } from '../tasks/validate-payload';
import { createWorker } from '../workers/worker';

export type CadenceOptions = {
  driver: Driver;
};

export type Cadence = {
  enqueue<Name extends string, Input, Payload extends JsonValue>(
    task: TaskDefinition<Name, Input, Payload>,
    payload: NoInfer<Input>,
    options?: EnqueueOptions,
  ): Promise<Job<Payload>>;
  getJob(id: string): Promise<Job | undefined>;
  pruneJobs(options: PruneJobsOptions): Promise<number>;
  readonly schedules: ScheduleClient;
  createWorker(options: WorkerOptions): Worker;
  close(options?: StopWorkerOptions): Promise<void>;
};

export function createCadence({ driver }: CadenceOptions): Cadence {
  let initialized = false;
  let initialization: Promise<void> | undefined;
  let lifecycle: 'open' | 'closing' | 'closed' = 'open';
  let closePromise: Promise<void> | undefined;
  const workers = new Set<Worker>();

  const assertOpen = (): void => {
    if (lifecycle !== 'open') {
      throw createError({
        code: 'client.closed',
        message: 'The Cadence client is closed',
      });
    }
  };

  const ensureInitialized = async (): Promise<void> => {
    assertOpen();
    if (initialized) {
      return;
    }

    initialization ??= driver.initialize().then(() => {
      initialized = true;
    });

    try {
      await initialization;
    } finally {
      if (!initialized) {
        initialization = undefined;
      }
    }
  };

  const schedules: ScheduleClient = {
    upsert: async <Name extends string, Input, Payload extends JsonValue>({
      id,
      task,
      payload,
      trigger,
    }: {
      id: string;
      task: TaskDefinition<Name, Input, Payload>;
      payload: NoInfer<Input>;
      trigger: { cron: string; timeZone?: string };
    }): Promise<Schedule<Payload>> => {
      assertOpen();
      assertScheduleId(id);
      const normalizedTrigger = { cron: trigger.cron, timeZone: trigger.timeZone ?? 'UTC' };
      const validatedPayload = cloneJsonValue(validatePayload(task.schema, payload));
      const retry = cloneRetryPolicy(task.retry);

      // Parse before any asynchronous driver operation so invalid configuration cannot mutate storage.
      getNextExecutionDate(normalizedTrigger.cron, {
        after: Temporal.Instant.fromEpochMilliseconds(0),
        timeZone: normalizedTrigger.timeZone,
        hashSeed: id,
      });

      await ensureInitialized();
      const now = normalizeInstant(await driver.now());
      const nextRunAt = getNextExecutionDate(normalizedTrigger.cron, {
        after: now,
        timeZone: normalizedTrigger.timeZone,
        hashSeed: id,
      });
      return (await driver.upsertSchedule({
        id,
        taskName: task.name,
        payload: validatedPayload,
        retry,
        trigger: normalizedTrigger,
        nextRunAt,
      })) as Schedule<Payload>;
    },
    get: async (id): Promise<Schedule | undefined> => {
      assertOpen();
      assertScheduleId(id);
      await ensureInitialized();
      return driver.getSchedule(id);
    },
    delete: async (id): Promise<boolean> => {
      assertOpen();
      assertScheduleId(id);
      await ensureInitialized();
      return driver.deleteSchedule(id);
    },
  };

  return {
    enqueue: async <Name extends string, Input, Payload extends JsonValue>(
      task: TaskDefinition<Name, Input, Payload>,
      payload: NoInfer<Input>,
      options?: EnqueueOptions,
    ): Promise<Job<Payload>> => {
      assertOpen();
      const validatedPayload = cloneJsonValue(validatePayload(task.schema, payload));
      const retry = cloneRetryPolicy(task.retry);
      const requestedRunAt =
        options?.runAt === undefined ? undefined : normalizeInstant(options.runAt);

      await ensureInitialized();
      const availableAt =
        requestedRunAt === undefined ? normalizeInstant(await driver.now()) : requestedRunAt;

      return (await driver.insertJob({
        id: randomUUID(),
        taskName: task.name,
        payload: validatedPayload,
        retry,
        availableAt,
      })) as Job<Payload>;
    },
    getJob: async (id: string): Promise<Job | undefined> => {
      assertOpen();
      await ensureInitialized();
      return driver.getJob(id);
    },
    pruneJobs: async (options: PruneJobsOptions): Promise<number> => {
      assertOpen();
      const before = normalizeInstant(options.before);
      const statuses = normalizePruneStatuses(options.statuses);
      const limit = options.limit ?? 1_000;
      assertPruneLimit(limit);

      await ensureInitialized();
      return driver.pruneJobs({ before, statuses, limit });
    },
    schedules,
    createWorker: (options: WorkerOptions): Worker => {
      assertOpen();
      const worker = createWorker({ driver, ensureInitialized, options });
      workers.add(worker);
      return worker;
    },
    close: async (options: StopWorkerOptions = {}): Promise<void> => {
      if (closePromise !== undefined) {
        return closePromise;
      }

      lifecycle = 'closing';
      closePromise = (async () => {
        let stopError: unknown;
        try {
          await Promise.all([...workers].map(async (worker) => worker.stop(options)));
        } catch (error) {
          stopError = error;
        }

        try {
          await driver.close();
        } finally {
          lifecycle = 'closed';
        }

        if (stopError !== undefined) {
          throw stopError;
        }
      })();
      return closePromise;
    },
  };
}

function normalizePruneStatuses(
  statuses: PruneJobsOptions['statuses'],
): ReadonlyArray<Extract<JobStatus, 'succeeded' | 'failed'>> {
  const normalized: Array<'succeeded' | 'failed'> =
    statuses === undefined ? ['succeeded', 'failed'] : [...statuses];
  if (normalized.some((status) => status !== 'succeeded' && status !== 'failed')) {
    throw createError({
      code: 'job.invalid-prune-options',
      message: 'statuses may only contain succeeded and failed',
    });
  }
  return [...new Set(normalized)];
}

function assertPruneLimit(limit: number): void {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 10_000) {
    throw createError({
      code: 'job.invalid-prune-options',
      message: 'limit must be an integer between 1 and 10,000',
    });
  }
}
