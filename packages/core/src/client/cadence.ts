import type { Driver } from '../driver/driver';
import type { EnqueueOptions, Job } from '../jobs/job';
import type { JsonValue } from '../shared/json';
import type { TaskDefinition } from '../tasks/task-definition';
import type { StopWorkerOptions, Worker, WorkerOptions } from '../workers/worker';
import { randomUUID } from 'node:crypto';
import { createError } from '../../errors/errors.models';
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
