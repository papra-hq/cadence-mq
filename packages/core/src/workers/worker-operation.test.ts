import type { ClaimedJob, Driver, HandlerContext, JsonValue, LeaseRef } from '../index';
import { describe, expect, test } from 'vitest';
import * as v from 'valibot';
import { defineHandler, defineTask, isCadenceError } from '../index';
import { runWorkerOperation } from './worker-operation';

const instant = Temporal.Instant.from('2026-01-01T00:00:00Z');

function createClaimDriver(job: ClaimedJob): {
  driver: Driver;
  completions: ReadonlyArray<LeaseRef>;
} {
  const completions: LeaseRef[] = [];

  return {
    completions,
    driver: {
      name: 'claim',
      initialize: async () => {},
      close: async () => {},
      now: async () => instant,
      insertJob: async () => job,
      getJob: async () => job,
      claimJobs: async () => [job],
      renewJobLeases: async ({ leases }) => leases.map(({ id }) => id),
      completeJob: async (lease) => {
        completions.push(lease);
        return true;
      },
      retryJob: async () => true,
      failJob: async () => true,
    },
  };
}

function claimedJob(payload: JsonValue): ClaimedJob {
  return {
    id: 'job-1',
    taskName: 'email.send',
    payload,
    status: 'running',
    attempts: 1,
    retry: { maxAttempts: 1 },
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
  });

  test('a corrupted persisted payload never reaches the handler', async () => {
    const task = defineTask({
      name: 'email.send',
      schema: v.object({ recipient: v.string() }),
    });
    let executions = 0;
    const handler = defineHandler(task, () => {
      executions += 1;
    });
    const claim = createClaimDriver(claimedJob({ recipient: 42 }));

    await expect(
      runWorkerOperation({
        driver: claim.driver,
        handlers: new Map([[handler.taskName, handler]]),
        concurrency: 1,
        leaseDurationMs: 30_000,
      }),
    ).rejects.toSatisfy(
      (error: unknown) => isCadenceError(error) && error.code === 'payload.invalid',
    );
    expect(executions).toBe(0);
    expect(claim.completions).toEqual([]);
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
});
