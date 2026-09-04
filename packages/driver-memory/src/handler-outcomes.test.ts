import type { CadenceError, Driver, LeaseRef } from '@cadence-mq/core';
import { describe, expect, test } from 'vitest';
import * as v from 'valibot';
import {
  createCadence,
  createControlledClock,
  defineHandler,
  defineTask,
  PermanentTaskError,
} from '@cadence-mq/core';
import { memory } from './memory-driver';

const start = Temporal.Instant.from('2026-01-01T00:00:00Z');

describe('memory handler outcomes', () => {
  test('an immediate retry is persisted and succeeds on a later claim', async () => {
    const clock = createControlledClock({ now: start });
    const backingDriver = memory({ clock });
    const retryPersisted = Promise.withResolvers<void>();
    const completed = Promise.withResolvers<LeaseRef>();
    const driver: Driver = {
      ...backingDriver,
      retryJob: async (options) => {
        const retried = await backingDriver.retryJob(options);
        if (retried) {
          retryPersisted.resolve();
        }
        return retried;
      },
      completeJob: async (lease) => {
        const completion = await backingDriver.completeJob(lease);
        if (completion) {
          completed.resolve(lease);
        }
        return completion;
      },
    };
    const task = defineTask({
      name: 'outcome.immediate',
      schema: v.null(),
      retry: { maxAttempts: 2 },
    });
    const attempts: number[] = [];
    const infrastructureErrors: CadenceError[] = [];
    const cadence = createCadence({ driver });
    const worker = cadence.createWorker({
      handlers: [
        defineHandler(task, (_payload, { attempt }) => {
          attempts.push(attempt);
          if (attempt === 1) {
            throw new Error('temporary failure');
          }
        }),
      ],
      pollingIntervalMs: 10,
      leaseDurationMs: 1_000,
      heartbeatIntervalMs: 100,
      scheduler: clock,
      onError: (error) => infrastructureErrors.push(error),
    });
    const job = await cadence.enqueue(task, null);

    await worker.start();
    await retryPersisted.promise;
    expect(await cadence.getJob(job.id)).toMatchObject({
      status: 'pending',
      attempts: 1,
      availableAt: start,
      lastError: { name: 'Error', message: 'temporary failure' },
    });

    clock.advanceBy({ milliseconds: 10 });
    await completed.promise;
    await worker.stop();

    expect(attempts).toEqual([1, 2]);
    expect(await cadence.getJob(job.id)).toMatchObject({ status: 'succeeded', attempts: 2 });
    expect(infrastructureErrors).toEqual([]);
  });

  test('a fixed retry persists its configured future availability', async () => {
    const clock = createControlledClock({ now: start });
    const backingDriver = memory({ clock });
    const retryPersisted = Promise.withResolvers<void>();
    const driver: Driver = {
      ...backingDriver,
      retryJob: async (options) => {
        const retried = await backingDriver.retryJob(options);
        if (retried) {
          retryPersisted.resolve();
        }
        return retried;
      },
    };
    const task = defineTask({
      name: 'outcome.fixed',
      schema: v.null(),
      retry: { maxAttempts: 2, backoff: { type: 'fixed', delayMs: 250 } },
    });
    const cadence = createCadence({ driver });
    const worker = cadence.createWorker({
      handlers: [
        defineHandler(task, () => {
          throw new Error('try later');
        }),
      ],
      pollingIntervalMs: 10,
      leaseDurationMs: 1_000,
      heartbeatIntervalMs: 100,
      scheduler: clock,
    });
    const job = await cadence.enqueue(task, null);

    await worker.start();
    await retryPersisted.promise;
    await worker.stop();

    expect(await cadence.getJob(job.id)).toMatchObject({
      status: 'pending',
      attempts: 1,
      availableAt: start.add({ milliseconds: 250 }),
      lastError: { message: 'try later' },
    });
  });

  test('exponential retries double from the failed attempt and respect their cap', async () => {
    const clock = createControlledClock({ now: start });
    const backingDriver = memory({ clock });
    const firstRetry = Promise.withResolvers<void>();
    const secondRetry = Promise.withResolvers<void>();
    const thirdRetry = Promise.withResolvers<void>();
    let retries = 0;
    const driver: Driver = {
      ...backingDriver,
      retryJob: async (options) => {
        const retried = await backingDriver.retryJob(options);
        if (retried) {
          retries += 1;
          [firstRetry, secondRetry, thirdRetry][retries - 1]?.resolve();
        }
        return retried;
      },
    };
    const task = defineTask({
      name: 'outcome.exponential',
      schema: v.null(),
      retry: {
        maxAttempts: 4,
        backoff: { type: 'exponential', initialDelayMs: 100, maxDelayMs: 250 },
      },
    });
    const cadence = createCadence({ driver });
    const worker = cadence.createWorker({
      handlers: [
        defineHandler(task, () => {
          throw new Error('try later');
        }),
      ],
      pollingIntervalMs: 10,
      leaseDurationMs: 1_000,
      heartbeatIntervalMs: 100,
      scheduler: clock,
    });
    const job = await cadence.enqueue(task, null);

    await worker.start();
    await firstRetry.promise;
    expect((await cadence.getJob(job.id))?.availableAt).toEqual(start.add({ milliseconds: 100 }));

    clock.advanceBy({ milliseconds: 100 });
    await secondRetry.promise;
    expect((await cadence.getJob(job.id))?.availableAt).toEqual(start.add({ milliseconds: 300 }));

    clock.advanceBy({ milliseconds: 200 });
    await thirdRetry.promise;
    await worker.stop();
    expect(await cadence.getJob(job.id)).toMatchObject({
      status: 'pending',
      attempts: 3,
      availableAt: start.add({ milliseconds: 550 }),
    });
  });

  test('exhausted, permanent, and corrupted jobs become failed outcomes', async () => {
    const clock = createControlledClock({ now: start });
    const backingDriver = memory({ clock });
    const allFailed = Promise.withResolvers<void>();
    const failedIds = new Set<string>();
    const driver: Driver = {
      ...backingDriver,
      failJob: async (options) => {
        const failed = await backingDriver.failJob(options);
        if (failed) {
          failedIds.add(options.lease.id);
          if (failedIds.size === 3) {
            allFailed.resolve();
          }
        }
        return failed;
      },
    };
    const exhaustedTask = defineTask({ name: 'outcome.exhausted', schema: v.null() });
    const permanentTask = defineTask({
      name: 'outcome.permanent',
      schema: v.null(),
      retry: { maxAttempts: 3 },
    });
    const corruptedTask = defineTask({
      name: 'outcome.corrupted',
      schema: v.object({ value: v.string() }),
      retry: { maxAttempts: 3 },
    });
    let corruptedExecutions = 0;
    const infrastructureErrors: CadenceError[] = [];
    const cadence = createCadence({ driver });
    const exhaustedJob = await cadence.enqueue(exhaustedTask, null);
    const permanentJob = await cadence.enqueue(permanentTask, null);
    await driver.insertJob({
      id: 'corrupted-job',
      taskName: corruptedTask.name,
      payload: { value: 42 },
      retry: corruptedTask.retry,
      availableAt: start,
    });
    const worker = cadence.createWorker({
      handlers: [
        defineHandler(exhaustedTask, () => {
          throw new Error('attempts exhausted');
        }),
        defineHandler(permanentTask, () => {
          throw new PermanentTaskError('invalid recipient');
        }),
        defineHandler(corruptedTask, () => {
          corruptedExecutions += 1;
        }),
      ],
      concurrency: 3,
      pollingIntervalMs: 10,
      leaseDurationMs: 1_000,
      heartbeatIntervalMs: 100,
      scheduler: clock,
      onError: (error) => infrastructureErrors.push(error),
    });

    await worker.start();
    await allFailed.promise;
    await worker.stop();

    expect(await cadence.getJob(exhaustedJob.id)).toMatchObject({
      status: 'failed',
      attempts: 1,
      lastError: { name: 'Error', message: 'attempts exhausted' },
    });
    expect(await cadence.getJob(permanentJob.id)).toMatchObject({
      status: 'failed',
      attempts: 1,
      lastError: { name: 'PermanentTaskError', message: 'invalid recipient' },
    });
    expect(await cadence.getJob('corrupted-job')).toMatchObject({
      status: 'failed',
      attempts: 1,
      lastError: { name: 'CadenceError', code: 'payload.invalid' },
    });
    expect(corruptedExecutions).toBe(0);
    expect(infrastructureErrors).toEqual([]);
  });

  test('stale retry and failure transitions are not repeated or reported as handler errors', async () => {
    const clock = createControlledClock({ now: start });
    const backingDriver = memory({ clock });
    const retryObserved = Promise.withResolvers<void>();
    const failureObserved = Promise.withResolvers<void>();
    let retryCalls = 0;
    let failureCalls = 0;
    const driver: Driver = {
      ...backingDriver,
      retryJob: async () => {
        retryCalls += 1;
        retryObserved.resolve();
        return false;
      },
      failJob: async () => {
        failureCalls += 1;
        failureObserved.resolve();
        return false;
      },
    };
    const retryTask = defineTask({
      name: 'outcome.stale-retry',
      schema: v.null(),
      retry: { maxAttempts: 2 },
    });
    const failureTask = defineTask({
      name: 'outcome.stale-failure',
      schema: v.null(),
      retry: { maxAttempts: 2 },
    });
    const infrastructureErrors: CadenceError[] = [];
    const cadence = createCadence({ driver });
    const retryJob = await cadence.enqueue(retryTask, null);
    const failureJob = await cadence.enqueue(failureTask, null);
    const worker = cadence.createWorker({
      handlers: [
        defineHandler(retryTask, () => {
          throw new Error('retry');
        }),
        defineHandler(failureTask, () => {
          throw new PermanentTaskError('fail');
        }),
      ],
      concurrency: 2,
      pollingIntervalMs: 10,
      leaseDurationMs: 1_000,
      heartbeatIntervalMs: 100,
      scheduler: clock,
      onError: (error) => infrastructureErrors.push(error),
    });

    await worker.start();
    await Promise.all([retryObserved.promise, failureObserved.promise]);
    await worker.stop();

    expect(retryCalls).toBe(1);
    expect(failureCalls).toBe(1);
    expect(await cadence.getJob(retryJob.id)).toMatchObject({ status: 'running', attempts: 1 });
    expect(await cadence.getJob(failureJob.id)).toMatchObject({ status: 'running', attempts: 1 });
    expect(infrastructureErrors).toEqual([]);
  });
});
