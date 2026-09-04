import type { CadenceError, Driver, LeaseRef } from '@cadence-mq/core';
import type { Client } from '@libsql/client';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import {
  createCadence,
  createControlledClock,
  defineHandler,
  defineTask,
  PermanentTaskError,
  systemClock,
} from '@cadence-mq/core';
import { createClient } from '@libsql/client';
import * as v from 'valibot';
import { createLibsqlDriver } from './libsql-driver';

let directory: string;
let databaseUrl: string;
let clients: Client[];

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'cadence-libsql-outcomes-'));
  databaseUrl = `file:${join(directory, 'queue.db')}`;
  clients = [];
});

afterEach(async () => {
  for (const client of clients) {
    client.close();
  }
  await rm(directory, { recursive: true, force: true });
});

function createDriver(): Driver {
  const client = createClient({ url: databaseUrl, timeout: 5_000 });
  clients.push(client);
  return createLibsqlDriver({ client });
}

async function waitUntilDue(driver: Driver, availableAt: Temporal.Instant): Promise<void> {
  while (Temporal.Instant.compare(await driver.now(), availableAt) < 0) {
    await systemClock.sleep(1);
  }
}

type RetryWindow = {
  before: Temporal.Instant;
  after: Temporal.Instant;
  delayMs: number;
};

describe('LibSQL handler outcomes', () => {
  test('an immediate retry is persisted and succeeds on a later claim', async () => {
    const scheduler = createControlledClock();
    const backingDriver = createDriver();
    const observerDriver = createDriver();
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
      leaseDurationMs: 30_000,
      heartbeatIntervalMs: 10_000,
      scheduler,
      onError: (error) => infrastructureErrors.push(error),
    });
    const job = await cadence.enqueue(task, null);
    await observerDriver.initialize();

    await worker.start();
    await retryPersisted.promise;
    expect(await observerDriver.getJob(job.id)).toMatchObject({
      status: 'pending',
      attempts: 1,
      lastError: { name: 'Error', message: 'temporary failure' },
    });

    scheduler.advanceBy({ milliseconds: 10 });
    await completed.promise;
    await worker.stop();

    expect(attempts).toEqual([1, 2]);
    expect(await observerDriver.getJob(job.id)).toMatchObject({ status: 'succeeded', attempts: 2 });
    expect(infrastructureErrors).toEqual([]);
  });

  test('a fixed retry persists its configured future availability', async () => {
    const scheduler = createControlledClock();
    const backingDriver = createDriver();
    const observerDriver = createDriver();
    const retryPersisted = Promise.withResolvers<void>();
    let retryWindow: RetryWindow | undefined;
    const driver: Driver = {
      ...backingDriver,
      retryJob: async (options) => {
        const before = await backingDriver.now();
        const retried = await backingDriver.retryJob(options);
        const after = await backingDriver.now();
        if (retried) {
          retryWindow = { before, after, delayMs: options.delayMs };
          retryPersisted.resolve();
        }
        return retried;
      },
    };
    const task = defineTask({
      name: 'outcome.fixed',
      schema: v.null(),
      retry: { maxAttempts: 2, backoff: { type: 'fixed', delayMs: 5_000 } },
    });
    const cadence = createCadence({ driver });
    const worker = cadence.createWorker({
      handlers: [
        defineHandler(task, () => {
          throw new Error('try later');
        }),
      ],
      pollingIntervalMs: 10,
      leaseDurationMs: 30_000,
      heartbeatIntervalMs: 10_000,
      scheduler,
    });
    const job = await cadence.enqueue(task, null);
    await observerDriver.initialize();

    await worker.start();
    await retryPersisted.promise;
    await worker.stop();

    const persisted = await observerDriver.getJob(job.id);
    if (persisted === undefined || retryWindow === undefined) {
      throw new Error('Expected the fixed retry to be persisted');
    }
    expect(retryWindow.delayMs).toBe(5_000);
    expect(persisted).toMatchObject({
      status: 'pending',
      attempts: 1,
      lastError: { message: 'try later' },
    });
    expect(
      Temporal.Instant.compare(
        persisted.availableAt,
        retryWindow.before.add({ milliseconds: retryWindow.delayMs }),
      ),
    ).toBeGreaterThanOrEqual(0);
    expect(
      Temporal.Instant.compare(
        persisted.availableAt,
        retryWindow.after.add({ milliseconds: retryWindow.delayMs }),
      ),
    ).toBeLessThanOrEqual(0);
  });

  test('exponential retries use the failed attempt and persist each delay', async () => {
    const scheduler = createControlledClock();
    const backingDriver = createDriver();
    const observerDriver = createDriver();
    const firstRetry = Promise.withResolvers<void>();
    const secondRetry = Promise.withResolvers<void>();
    const retryWindows: RetryWindow[] = [];
    const driver: Driver = {
      ...backingDriver,
      retryJob: async (options) => {
        const before = await backingDriver.now();
        const retried = await backingDriver.retryJob(options);
        const after = await backingDriver.now();
        if (retried) {
          retryWindows.push({ before, after, delayMs: options.delayMs });
          [firstRetry, secondRetry][retryWindows.length - 1]?.resolve();
        }
        return retried;
      },
    };
    const task = defineTask({
      name: 'outcome.exponential',
      schema: v.null(),
      retry: {
        maxAttempts: 3,
        backoff: { type: 'exponential', initialDelayMs: 20, maxDelayMs: 100 },
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
      leaseDurationMs: 30_000,
      heartbeatIntervalMs: 10_000,
      scheduler,
    });
    const job = await cadence.enqueue(task, null);
    await observerDriver.initialize();

    await worker.start();
    await firstRetry.promise;
    const firstPersisted = await observerDriver.getJob(job.id);
    if (firstPersisted === undefined) {
      throw new Error('Expected the first exponential retry to be persisted');
    }
    await waitUntilDue(observerDriver, firstPersisted.availableAt);

    scheduler.advanceBy({ milliseconds: 10 });
    await secondRetry.promise;
    await worker.stop();

    expect(retryWindows.map(({ delayMs }) => delayMs)).toEqual([20, 40]);
    const persisted = await observerDriver.getJob(job.id);
    const secondWindow = retryWindows[1];
    if (persisted === undefined || secondWindow === undefined) {
      throw new Error('Expected the second exponential retry to be persisted');
    }
    expect(persisted).toMatchObject({ status: 'pending', attempts: 2 });
    expect(
      Temporal.Instant.compare(
        persisted.availableAt,
        secondWindow.before.add({ milliseconds: secondWindow.delayMs }),
      ),
    ).toBeGreaterThanOrEqual(0);
    expect(
      Temporal.Instant.compare(
        persisted.availableAt,
        secondWindow.after.add({ milliseconds: secondWindow.delayMs }),
      ),
    ).toBeLessThanOrEqual(0);
  });

  test('exhausted, permanent, and corrupted jobs become failed outcomes', async () => {
    const scheduler = createControlledClock();
    const backingDriver = createDriver();
    const observerDriver = createDriver();
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
      availableAt: await driver.now(),
    });
    await observerDriver.initialize();
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
      leaseDurationMs: 30_000,
      heartbeatIntervalMs: 10_000,
      scheduler,
      onError: (error) => infrastructureErrors.push(error),
    });

    await worker.start();
    await allFailed.promise;
    await worker.stop();

    expect(await observerDriver.getJob(exhaustedJob.id)).toMatchObject({
      status: 'failed',
      attempts: 1,
      lastError: { name: 'Error', message: 'attempts exhausted' },
    });
    expect(await observerDriver.getJob(permanentJob.id)).toMatchObject({
      status: 'failed',
      attempts: 1,
      lastError: { name: 'PermanentTaskError', message: 'invalid recipient' },
    });
    expect(await observerDriver.getJob('corrupted-job')).toMatchObject({
      status: 'failed',
      attempts: 1,
      lastError: { name: 'CadenceError', code: 'payload.invalid' },
    });
    expect(corruptedExecutions).toBe(0);
    expect(infrastructureErrors).toEqual([]);
  });

  test('stale retry and failure transitions are not repeated or reported as handler errors', async () => {
    const scheduler = createControlledClock();
    const backingDriver = createDriver();
    const observerDriver = createDriver();
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
    await observerDriver.initialize();
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
      leaseDurationMs: 30_000,
      heartbeatIntervalMs: 10_000,
      scheduler,
      onError: (error) => infrastructureErrors.push(error),
    });

    await worker.start();
    await Promise.all([retryObserved.promise, failureObserved.promise]);
    await worker.stop();

    expect(retryCalls).toBe(1);
    expect(failureCalls).toBe(1);
    expect(await observerDriver.getJob(retryJob.id)).toMatchObject({
      status: 'running',
      attempts: 1,
    });
    expect(await observerDriver.getJob(failureJob.id)).toMatchObject({
      status: 'running',
      attempts: 1,
    });
    expect(infrastructureErrors).toEqual([]);
  });
});
