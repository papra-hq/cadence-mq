import type {
  ClaimedJob,
  Driver,
  HandlerContext,
  JsonValue,
  LeaseRef,
  RetryPolicy,
  SerializedJobError,
} from '../index';
import { describe, expect, test } from 'vitest';
import * as v from 'valibot';
import { defineHandler, defineTask, isCadenceError, PermanentTaskError } from '../index';
import { runWorkerOperation } from './worker-operation';

const instant = Temporal.Instant.from('2026-01-01T00:00:00Z');

type FailureTransition = {
  lease: LeaseRef;
  error: SerializedJobError;
};

type RetryTransition = FailureTransition & {
  delayMs: number;
};

function createClaimDriver(job: ClaimedJob): {
  driver: Driver;
  completions: ReadonlyArray<LeaseRef>;
  retries: ReadonlyArray<RetryTransition>;
  failures: ReadonlyArray<FailureTransition>;
} {
  const completions: LeaseRef[] = [];
  const retries: RetryTransition[] = [];
  const failures: FailureTransition[] = [];

  return {
    completions,
    retries,
    failures,
    driver: {
      name: 'claim',
      initialize: async () => {},
      close: async () => {},
      now: async () => instant,
      insertJob: async () => job,
      getJob: async () => job,
      pruneJobs: async () => 0,
      claimJobs: async () => [job],
      renewJobLeases: async ({ leases }) => leases.map(({ id }) => id),
      completeJob: async (lease) => {
        completions.push(lease);
        return true;
      },
      retryJob: async (options) => {
        retries.push(options);
        return true;
      },
      failJob: async (options) => {
        failures.push(options);
        return true;
      },
      upsertSchedule: async () => {
        throw new Error('not implemented');
      },
      getSchedule: async () => undefined,
      deleteSchedule: async () => false,
      claimDueSchedules: async () => [],
      commitScheduleOccurrence: async () => false,
      releaseScheduleClaim: async () => false,
    },
  };
}

function claimedJob(
  payload: JsonValue,
  { attempts = 1, retry = { maxAttempts: 1 } }: { attempts?: number; retry?: RetryPolicy } = {},
): ClaimedJob {
  return {
    id: 'job-1',
    taskName: 'email.send',
    payload,
    status: 'running',
    attempts,
    retry,
    createdAt: instant,
    availableAt: instant,
    startedAt: instant,
    leaseToken: 'lease-1',
    leaseExpiresAt: instant.add({ seconds: 30 }),
  };
}

describe('runWorkerOperation', () => {
  test('a claimed job is validated, executed, and completed with its lease token', async () => {
    const task = defineTask({
      name: 'email.send',
      schema: v.object({ recipient: v.string() }),
    });
    const contexts: HandlerContext[] = [];
    const payloads: Array<{ recipient: string }> = [];
    const handler = defineHandler(task, (payload, context) => {
      payloads.push(payload);
      contexts.push(context);
    });
    const claim = createClaimDriver(claimedJob({ recipient: 'jane@example.com' }));

    const count = await runWorkerOperation({
      driver: claim.driver,
      handlers: new Map([[handler.taskName, handler]]),
      concurrency: 1,
      leaseDurationMs: 30_000,
    });

    expect(count).toBe(1);
    expect(payloads).toEqual([{ recipient: 'jane@example.com' }]);
    expect(contexts[0]).toMatchObject({
      jobId: 'job-1',
      taskName: 'email.send',
      attempt: 1,
    });
    expect(contexts[0]?.signal).toBeInstanceOf(AbortSignal);
    expect(claim.completions).toEqual([{ id: 'job-1', token: 'lease-1' }]);
    expect(claim.retries).toEqual([]);
    expect(claim.failures).toEqual([]);
  });

  test('a corrupted persisted payload is permanently failed without reaching the handler', async () => {
    const task = defineTask({
      name: 'email.send',
      schema: v.object({ recipient: v.string() }),
    });
    let executions = 0;
    const handler = defineHandler(task, () => {
      executions += 1;
    });
    const claim = createClaimDriver(claimedJob({ recipient: 42 }, { retry: { maxAttempts: 3 } }));

    await expect(
      runWorkerOperation({
        driver: claim.driver,
        handlers: new Map([[handler.taskName, handler]]),
        concurrency: 1,
        leaseDurationMs: 30_000,
      }),
    ).resolves.toBe(1);

    expect(executions).toBe(0);
    expect(claim.completions).toEqual([]);
    expect(claim.retries).toEqual([]);
    expect(claim.failures).toEqual([
      {
        lease: { id: 'job-1', token: 'lease-1' },
        error: expect.objectContaining({
          name: 'CadenceError',
          code: 'payload.invalid',
        }),
      },
    ]);
  });

  test('an ordinary handler failure is serialized and retried with its configured delay', async () => {
    const task = defineTask({
      name: 'email.send',
      schema: v.object({ recipient: v.string() }),
    });
    const error = Object.assign(new Error('delivery timed out'), { code: 'delivery.timeout' });
    const handler = defineHandler(task, () => {
      throw error;
    });
    const claim = createClaimDriver(
      claimedJob(
        { recipient: 'jane@example.com' },
        {
          retry: { maxAttempts: 3, backoff: { type: 'fixed', delayMs: 250 } },
        },
      ),
    );

    await expect(
      runWorkerOperation({
        driver: claim.driver,
        handlers: new Map([[handler.taskName, handler]]),
        concurrency: 1,
        leaseDurationMs: 30_000,
      }),
    ).resolves.toBe(1);

    expect(claim.retries).toEqual([
      {
        lease: { id: 'job-1', token: 'lease-1' },
        delayMs: 250,
        error: expect.objectContaining({
          name: 'Error',
          message: 'delivery timed out',
          code: 'delivery.timeout',
        }),
      },
    ]);
    expect(claim.failures).toEqual([]);
  });

  test('an ordinary handler failure is terminal after all attempts are exhausted', async () => {
    const task = defineTask({ name: 'email.send', schema: v.null() });
    const handler = defineHandler(task, () => {
      throw 'still failing';
    });
    const claim = createClaimDriver(claimedJob(null, { attempts: 3, retry: { maxAttempts: 3 } }));

    await runWorkerOperation({
      driver: claim.driver,
      handlers: new Map([[handler.taskName, handler]]),
      concurrency: 1,
      leaseDurationMs: 30_000,
    });

    expect(claim.retries).toEqual([]);
    expect(claim.failures).toEqual([
      {
        lease: { id: 'job-1', token: 'lease-1' },
        error: { name: 'Error', message: 'still failing' },
      },
    ]);
  });

  test('PermanentTaskError bypasses remaining attempts', async () => {
    const task = defineTask({ name: 'email.send', schema: v.null() });
    const handler = defineHandler(task, () => {
      throw new PermanentTaskError('recipient is blocked');
    });
    const claim = createClaimDriver(claimedJob(null, { attempts: 1, retry: { maxAttempts: 3 } }));

    await runWorkerOperation({
      driver: claim.driver,
      handlers: new Map([[handler.taskName, handler]]),
      concurrency: 1,
      leaseDurationMs: 30_000,
    });

    expect(claim.retries).toEqual([]);
    expect(claim.failures).toEqual([
      {
        lease: { id: 'job-1', token: 'lease-1' },
        error: expect.objectContaining({
          name: 'PermanentTaskError',
          message: 'recipient is blocked',
        }),
      },
    ]);
  });

  test('a stale completion is surfaced without retrying the transition', async () => {
    const task = defineTask({ name: 'email.send', schema: v.object({ recipient: v.string() }) });
    const handler = defineHandler(task, () => {});
    const job = claimedJob({ recipient: 'jane@example.com' });
    let completions = 0;
    const driver: Driver = {
      ...createClaimDriver(job).driver,
      completeJob: async () => {
        completions += 1;
        return false;
      },
    };

    await expect(
      runWorkerOperation({
        driver,
        handlers: new Map([[handler.taskName, handler]]),
        concurrency: 1,
        leaseDurationMs: 30_000,
      }),
    ).rejects.toSatisfy(
      (error: unknown) => isCadenceError(error) && error.code === 'job.stale-lease',
    );
    expect(completions).toBe(1);
  });

  test('a stale retry is surfaced without repeating the transition', async () => {
    const task = defineTask({ name: 'email.send', schema: v.null() });
    const handler = defineHandler(task, () => {
      throw new Error('transient');
    });
    const job = claimedJob(null, { retry: { maxAttempts: 2 } });
    let retries = 0;
    const driver: Driver = {
      ...createClaimDriver(job).driver,
      retryJob: async () => {
        retries += 1;
        return false;
      },
    };

    await expect(
      runWorkerOperation({
        driver,
        handlers: new Map([[handler.taskName, handler]]),
        concurrency: 1,
        leaseDurationMs: 30_000,
      }),
    ).rejects.toMatchObject({ code: 'job.stale-lease' });
    expect(retries).toBe(1);
  });

  test('a stale failure is surfaced without repeating the transition', async () => {
    const task = defineTask({ name: 'email.send', schema: v.null() });
    const handler = defineHandler(task, () => {
      throw new PermanentTaskError('permanent');
    });
    const job = claimedJob(null, { retry: { maxAttempts: 2 } });
    let failures = 0;
    const driver: Driver = {
      ...createClaimDriver(job).driver,
      failJob: async () => {
        failures += 1;
        return false;
      },
    };

    await expect(
      runWorkerOperation({
        driver,
        handlers: new Map([[handler.taskName, handler]]),
        concurrency: 1,
        leaseDurationMs: 30_000,
      }),
    ).rejects.toMatchObject({ code: 'job.stale-lease' });
    expect(failures).toBe(1);
  });
});
