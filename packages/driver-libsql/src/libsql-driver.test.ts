import type { Driver, JsonValue, LeaseRef, NewJob } from '@cadence-mq/core';
import type { Client } from '@libsql/client';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { createCadence, createControlledClock, defineHandler, defineTask } from '@cadence-mq/core';
import { createClient } from '@libsql/client';
import * as v from 'valibot';
import { createLibsqlDriver } from './libsql-driver';

let directory: string;
let databaseUrl: string;
let clients: Client[];

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'cadence-libsql-'));
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

async function newJob({
  driver,
  id,
  payload = { id },
  availableAt,
  maxAttempts = 2,
}: {
  driver: Driver;
  id: string;
  payload?: JsonValue;
  availableAt?: Temporal.Instant;
  maxAttempts?: number;
}): Promise<NewJob> {
  return {
    id,
    taskName: 'email.send',
    payload,
    retry: { maxAttempts },
    availableAt: availableAt ?? (await driver.now()),
  };
}

describe('LibSQL driver', () => {
  test('initialization is idempotent across independent clients', async () => {
    const firstDriver = createDriver();
    const secondDriver = createDriver();

    await Promise.all([firstDriver.initialize(), secondDriver.initialize()]);
    await Promise.all([firstDriver.initialize(), secondDriver.initialize()]);

    const inserted = await firstDriver.insertJob(
      await newJob({ driver: firstDriver, id: 'job-1' }),
    );
    expect((await secondDriver.getJob(inserted.id))?.id).toBe('job-1');
  });

  test('payloads are isolated through serialization', async () => {
    const driver = createDriver();
    await driver.initialize();
    const payload = { nested: { value: 'original' } };

    const inserted = await driver.insertJob(await newJob({ driver, id: 'job-1', payload }));
    payload.nested.value = 'input mutation';
    (inserted.payload as typeof payload).nested.value = 'return mutation';

    expect((await driver.getJob('job-1'))?.payload).toEqual({
      nested: { value: 'original' },
    });
  });

  test('immediate jobs are claimed while future jobs remain pending', async () => {
    const driver = createDriver();
    await driver.initialize();
    const now = await driver.now();
    await driver.insertJob(await newJob({ driver, id: 'immediate', availableAt: now }));
    await driver.insertJob(
      await newJob({
        driver,
        id: 'delayed',
        availableAt: now.add({ hours: 1 }),
      }),
    );

    const claims = await driver.claimJobs({
      taskNames: ['email.send'],
      limit: 2,
      leaseDurationMs: 30_000,
    });

    expect(claims.map(({ id }) => id)).toEqual(['immediate']);
    expect(await driver.getJob('delayed')).toMatchObject({ status: 'pending', attempts: 0 });
  });

  test('independent clients cannot concurrently claim the same job', async () => {
    const firstDriver = createDriver();
    const secondDriver = createDriver();
    await Promise.all([firstDriver.initialize(), secondDriver.initialize()]);
    await firstDriver.insertJob(await newJob({ driver: firstDriver, id: 'job-1' }));

    const [firstClaims, secondClaims] = await Promise.all([
      firstDriver.claimJobs({
        taskNames: ['email.send'],
        limit: 1,
        leaseDurationMs: 30_000,
      }),
      secondDriver.claimJobs({
        taskNames: ['email.send'],
        limit: 1,
        leaseDurationMs: 30_000,
      }),
    ]);

    expect([...firstClaims, ...secondClaims]).toHaveLength(1);
    expect([...firstClaims, ...secondClaims][0]).toMatchObject({
      id: 'job-1',
      status: 'running',
      attempts: 1,
    });
  });

  test('a stale fencing token cannot complete a job reclaimed by another client', async () => {
    const firstDriver = createDriver();
    const secondDriver = createDriver();
    await Promise.all([firstDriver.initialize(), secondDriver.initialize()]);
    await firstDriver.insertJob(await newJob({ driver: firstDriver, id: 'job-1', maxAttempts: 2 }));

    const [firstClaim] = await firstDriver.claimJobs({
      taskNames: ['email.send'],
      limit: 1,
      leaseDurationMs: 0,
    });
    const [secondClaim] = await secondDriver.claimJobs({
      taskNames: ['email.send'],
      limit: 1,
      leaseDurationMs: 30_000,
    });

    expect(firstClaim).toBeDefined();
    expect(secondClaim).toBeDefined();
    expect(secondClaim?.leaseToken).not.toBe(firstClaim?.leaseToken);
    expect(
      await firstDriver.completeJob({ id: 'job-1', token: firstClaim?.leaseToken ?? '' }),
    ).toBe(false);
    expect(
      await secondDriver.completeJob({ id: 'job-1', token: secondClaim?.leaseToken ?? '' }),
    ).toBe(true);
  });

  test('only a matching unexpired lease can be renewed across independent clients', async () => {
    const firstDriver = createDriver();
    const secondDriver = createDriver();
    await Promise.all([firstDriver.initialize(), secondDriver.initialize()]);
    await firstDriver.insertJob(await newJob({ driver: firstDriver, id: 'job-1', maxAttempts: 2 }));

    const [expiredClaim] = await firstDriver.claimJobs({
      taskNames: ['email.send'],
      limit: 1,
      leaseDurationMs: 0,
    });
    const expiredLease = { id: 'job-1', token: expiredClaim?.leaseToken ?? '' };
    expect(
      await firstDriver.renewJobLeases({ leases: [expiredLease], leaseDurationMs: 30_000 }),
    ).toEqual([]);

    const [currentClaim] = await secondDriver.claimJobs({
      taskNames: ['email.send'],
      limit: 1,
      leaseDurationMs: 30_000,
    });
    const currentLease = { id: 'job-1', token: currentClaim?.leaseToken ?? '' };
    expect(
      await firstDriver.renewJobLeases({ leases: [expiredLease], leaseDurationMs: 30_000 }),
    ).toEqual([]);
    expect(
      await secondDriver.renewJobLeases({ leases: [currentLease], leaseDurationMs: 30_000 }),
    ).toEqual(['job-1']);
    expect(
      await secondDriver.renewJobLeases({
        leases: [expiredLease, currentLease],
        leaseDurationMs: 30_000,
      }),
    ).toEqual(['job-1']);
  });

  test('retry and failure transitions reject stale fencing tokens', async () => {
    const driver = createDriver();
    await driver.initialize();
    await driver.insertJob(await newJob({ driver, id: 'retry', maxAttempts: 2 }));
    await driver.insertJob(await newJob({ driver, id: 'fail', maxAttempts: 1 }));
    const claims = await driver.claimJobs({
      taskNames: ['email.send'],
      limit: 2,
      leaseDurationMs: 30_000,
    });
    const retryClaim = claims.find(({ id }) => id === 'retry');
    const failClaim = claims.find(({ id }) => id === 'fail');
    const error = { name: 'AbortError', message: 'worker stopped', code: 'job.worker-shutdown' };

    expect(
      await driver.retryJob({
        lease: { id: 'retry', token: retryClaim?.leaseToken ?? '' },
        error,
        delayMs: 0,
      }),
    ).toBe(true);
    expect(
      await driver.retryJob({
        lease: { id: 'retry', token: retryClaim?.leaseToken ?? '' },
        error,
        delayMs: 0,
      }),
    ).toBe(false);
    expect(
      await driver.failJob({
        lease: { id: 'fail', token: failClaim?.leaseToken ?? '' },
        error,
      }),
    ).toBe(true);
    expect(
      await driver.failJob({
        lease: { id: 'fail', token: failClaim?.leaseToken ?? '' },
        error,
      }),
    ).toBe(false);

    expect(await driver.getJob('retry')).toMatchObject({ status: 'pending', lastError: error });
    expect(await driver.getJob('fail')).toMatchObject({ status: 'failed', lastError: error });
  });

  test('getJob observes pending, running, and succeeded transitions', async () => {
    const driver = createDriver();
    await driver.initialize();
    await driver.insertJob(await newJob({ driver, id: 'job-1' }));

    expect(await driver.getJob('job-1')).toMatchObject({ status: 'pending', attempts: 0 });
    const [claim] = await driver.claimJobs({
      taskNames: ['email.send'],
      limit: 1,
      leaseDurationMs: 30_000,
    });
    expect(await driver.getJob('job-1')).toMatchObject({ status: 'running', attempts: 1 });

    expect(await driver.completeJob({ id: 'job-1', token: claim?.leaseToken ?? '' })).toBe(true);
    expect(await driver.getJob('job-1')).toMatchObject({ status: 'succeeded', attempts: 1 });
    expect(await driver.getJob('missing')).toBeUndefined();
  });

  test('closing the driver repeatedly is safe', async () => {
    const driver = createDriver();
    await driver.initialize();

    await driver.close();
    await driver.close();
  });
});

describe('LibSQL fundamental queue path', () => {
  test('define, enqueue, claim, execute, complete, and inspect reaches succeeded', async () => {
    const backingDriver = createDriver();
    const completion = Promise.withResolvers<LeaseRef>();
    const driver: Driver = {
      ...backingDriver,
      completeJob: async (lease) => {
        const completed = await backingDriver.completeJob(lease);
        if (completed) {
          completion.resolve(lease);
        }
        return completed;
      },
    };
    const task = defineTask({
      name: 'email.send',
      schema: v.object({ recipient: v.string() }),
    });
    const received: Array<{ recipient: string }> = [];
    const cadence = createCadence({ driver });
    const worker = cadence.createWorker({
      handlers: [
        defineHandler(task, (payload) => {
          received.push(payload);
        }),
      ],
      pollingIntervalMs: 60_000,
      leaseDurationMs: 30_000,
    });

    const job = await cadence.enqueue(task, { recipient: 'jane@example.com' });
    await worker.start();
    await completion.promise;
    await worker.stop();

    expect(received).toEqual([{ recipient: 'jane@example.com' }]);
    expect(await cadence.getJob(job.id)).toMatchObject({
      taskName: 'email.send',
      status: 'succeeded',
      attempts: 1,
    });
  });

  test('a controlled heartbeat renews a long-running LibSQL claim', async () => {
    const scheduler = createControlledClock();
    const backingDriver = createDriver();
    const observerDriver = createDriver();
    const handlerStarted = Promise.withResolvers<void>();
    const finishHandler = Promise.withResolvers<void>();
    const heartbeat = Promise.withResolvers<void>();
    const completion = Promise.withResolvers<void>();
    const driver: Driver = {
      ...backingDriver,
      renewJobLeases: async (options) => {
        const renewed = await backingDriver.renewJobLeases(options);
        heartbeat.resolve();
        return renewed;
      },
      completeJob: async (lease) => {
        const completed = await backingDriver.completeJob(lease);
        if (completed) {
          completion.resolve();
        }
        return completed;
      },
    };
    const task = defineTask({
      name: 'libsql.heartbeat',
      schema: v.null(),
      retry: { maxAttempts: 2 },
    });
    const cadence = createCadence({ driver });
    const worker = cadence.createWorker({
      handlers: [
        defineHandler(task, async () => {
          handlerStarted.resolve();
          await finishHandler.promise;
        }),
      ],
      pollingIntervalMs: 100,
      leaseDurationMs: 30_000,
      heartbeatIntervalMs: 10,
      scheduler,
    });
    const job = await cadence.enqueue(task, null);
    await observerDriver.initialize();

    await worker.start();
    await handlerStarted.promise;
    scheduler.advanceBy({ milliseconds: 10 });
    await heartbeat.promise;
    expect(await observerDriver.getJob(job.id)).toMatchObject({ status: 'running', attempts: 1 });

    finishHandler.resolve();
    await completion.promise;
    await worker.stop();
    expect(await observerDriver.getJob(job.id)).toMatchObject({ status: 'succeeded', attempts: 1 });
  });

  test('controlled grace expiry releases and fails LibSQL claims for another client', async () => {
    const scheduler = createControlledClock();
    const driver = createDriver();
    const observerDriver = createDriver();
    const retryTask = defineTask({
      name: 'libsql.shutdown.retry',
      schema: v.null(),
      retry: { maxAttempts: 2 },
    });
    const failTask = defineTask({ name: 'libsql.shutdown.fail', schema: v.null() });
    const retryStarted = Promise.withResolvers<void>();
    const failStarted = Promise.withResolvers<void>();
    const retryAborted = Promise.withResolvers<void>();
    const failAborted = Promise.withResolvers<void>();
    const cadence = createCadence({ driver });
    const worker = cadence.createWorker({
      handlers: [
        defineHandler(retryTask, async (_payload, { signal }) => {
          retryStarted.resolve();
          signal.addEventListener('abort', () => retryAborted.resolve(), { once: true });
          await new Promise<never>(() => {});
        }),
        defineHandler(failTask, async (_payload, { signal }) => {
          failStarted.resolve();
          signal.addEventListener('abort', () => failAborted.resolve(), { once: true });
          await new Promise<never>(() => {});
        }),
      ],
      concurrency: 2,
      pollingIntervalMs: 100,
      leaseDurationMs: 30_000,
      heartbeatIntervalMs: 10,
      scheduler,
    });
    const retryJob = await cadence.enqueue(retryTask, null);
    const failJob = await cadence.enqueue(failTask, null);
    await observerDriver.initialize();

    await worker.start();
    await Promise.all([retryStarted.promise, failStarted.promise]);
    const stopping = worker.stop({ gracePeriodMs: 20 });
    scheduler.advanceBy({ milliseconds: 20 });
    await Promise.all([retryAborted.promise, failAborted.promise, stopping]);

    expect(await observerDriver.getJob(retryJob.id)).toMatchObject({
      status: 'pending',
      attempts: 1,
      lastError: { code: 'job.worker-shutdown' },
    });
    expect(await observerDriver.getJob(failJob.id)).toMatchObject({
      status: 'failed',
      attempts: 1,
      lastError: { code: 'job.worker-shutdown' },
    });
  });
});
