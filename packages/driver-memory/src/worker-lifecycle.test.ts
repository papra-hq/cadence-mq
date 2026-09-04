import type { Driver, LeaseRef } from '@cadence-mq/core';
import { describe, expect, test } from 'vitest';
import * as v from 'valibot';
import { createCadence, createControlledClock, defineHandler, defineTask } from '@cadence-mq/core';
import { memory } from './memory-driver';

const start = Temporal.Instant.from('2026-01-01T00:00:00Z');

describe('memory worker lifecycle', () => {
  test('heartbeats keep a long-running handler leased past its original expiry', async () => {
    const clock = createControlledClock({ now: start });
    const backingDriver = memory({ clock });
    const handlerStarted = Promise.withResolvers<void>();
    const finishHandler = Promise.withResolvers<void>();
    const heartbeat = Promise.withResolvers<void>();
    const completion = Promise.withResolvers<LeaseRef>();
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
          completion.resolve(lease);
        }
        return completed;
      },
    };
    const task = defineTask({
      name: 'heartbeat.long-running',
      schema: v.object({ value: v.string() }),
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
      leaseDurationMs: 30,
      heartbeatIntervalMs: 10,
      scheduler: clock,
    });
    const job = await cadence.enqueue(task, { value: 'work' });

    await worker.start();
    await handlerStarted.promise;
    clock.advanceBy({ milliseconds: 10 });
    await heartbeat.promise;

    clock.advanceBy({ milliseconds: 20 });
    expect(
      await backingDriver.claimJobs({
        taskNames: [task.name],
        limit: 1,
        leaseDurationMs: 30,
      }),
    ).toEqual([]);

    finishHandler.resolve();
    await completion.promise;
    await worker.stop();
    expect(await cadence.getJob(job.id)).toMatchObject({ status: 'succeeded', attempts: 1 });
  });

  test('a lost lease aborts only its associated handler', async () => {
    const clock = createControlledClock({ now: start });
    const backingDriver = memory({ clock });
    const lostStarted = Promise.withResolvers<void>();
    const currentStarted = Promise.withResolvers<void>();
    const lostAborted = Promise.withResolvers<void>();
    const finishCurrent = Promise.withResolvers<void>();
    const currentCompleted = Promise.withResolvers<void>();
    let lostJobId = '';
    let currentJobId = '';
    let currentSignal: AbortSignal | undefined;
    const driver: Driver = {
      ...backingDriver,
      renewJobLeases: async ({ leases, leaseDurationMs }) =>
        backingDriver.renewJobLeases({
          leases: leases.filter(({ id }) => id !== lostJobId),
          leaseDurationMs,
        }),
      completeJob: async (lease) => {
        const completed = await backingDriver.completeJob(lease);
        if (completed && lease.id === currentJobId) {
          currentCompleted.resolve();
        }
        return completed;
      },
    };
    const task = defineTask({
      name: 'heartbeat.associated-signal',
      schema: v.object({ kind: v.picklist(['lost', 'current']) }),
      retry: { maxAttempts: 2 },
    });
    const cadence = createCadence({ driver });
    const worker = cadence.createWorker({
      handlers: [
        defineHandler(task, async ({ kind }, { signal }) => {
          if (kind === 'lost') {
            lostStarted.resolve();
            await new Promise<never>((_resolve, reject) => {
              signal.addEventListener(
                'abort',
                () => {
                  lostAborted.resolve();
                  reject(signal.reason);
                },
                { once: true },
              );
            });
          }

          currentSignal = signal;
          currentStarted.resolve();
          await finishCurrent.promise;
        }),
      ],
      concurrency: 2,
      pollingIntervalMs: 100,
      leaseDurationMs: 30,
      heartbeatIntervalMs: 10,
      scheduler: clock,
    });
    lostJobId = (await cadence.enqueue(task, { kind: 'lost' })).id;
    currentJobId = (await cadence.enqueue(task, { kind: 'current' })).id;

    await worker.start();
    await Promise.all([lostStarted.promise, currentStarted.promise]);
    clock.advanceBy({ milliseconds: 10 });
    await lostAborted.promise;

    expect(currentSignal?.aborted).toBe(false);
    finishCurrent.resolve();
    await currentCompleted.promise;
    await worker.stop();
    expect(await cadence.getJob(currentJobId)).toMatchObject({ status: 'succeeded' });
  });

  test('a handler finishing during the grace period completes normally', async () => {
    const clock = createControlledClock({ now: start });
    const backingDriver = memory({ clock });
    const handlerStarted = Promise.withResolvers<void>();
    const finishHandler = Promise.withResolvers<void>();
    const completion = Promise.withResolvers<void>();
    let handlerSignal: AbortSignal | undefined;
    const driver: Driver = {
      ...backingDriver,
      completeJob: async (lease) => {
        const completed = await backingDriver.completeJob(lease);
        if (completed) {
          completion.resolve();
        }
        return completed;
      },
    };
    const task = defineTask({
      name: 'shutdown.within-grace',
      schema: v.null(),
    });
    const cadence = createCadence({ driver });
    const worker = cadence.createWorker({
      handlers: [
        defineHandler(task, async (_payload, { signal }) => {
          handlerSignal = signal;
          handlerStarted.resolve();
          await finishHandler.promise;
        }),
      ],
      pollingIntervalMs: 100,
      leaseDurationMs: 30,
      heartbeatIntervalMs: 10,
      scheduler: clock,
    });
    const job = await cadence.enqueue(task, null);

    await worker.start();
    await handlerStarted.promise;
    const stopping = worker.stop({ gracePeriodMs: 20 });
    finishHandler.resolve();

    await completion.promise;
    await stopping;
    expect(handlerSignal?.aborted).toBe(false);
    expect(await cadence.getJob(job.id)).toMatchObject({ status: 'succeeded' });
  });

  test('grace expiry aborts handlers and immediately retries or fails their jobs', async () => {
    const clock = createControlledClock({ now: start });
    const backingDriver = memory({ clock });
    let claimCalls = 0;
    const driver: Driver = {
      ...backingDriver,
      claimJobs: async (options) => {
        claimCalls += 1;
        return backingDriver.claimJobs(options);
      },
    };
    const retryTask = defineTask({
      name: 'shutdown.retry',
      schema: v.null(),
      retry: { maxAttempts: 2 },
    });
    const failTask = defineTask({
      name: 'shutdown.fail',
      schema: v.null(),
    });
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
      leaseDurationMs: 30,
      heartbeatIntervalMs: 10,
      scheduler: clock,
    });
    const retryJob = await cadence.enqueue(retryTask, null);
    const failJob = await cadence.enqueue(failTask, null);
    clock.advanceBy({ milliseconds: 1 });
    const unclaimedJob = await cadence.enqueue(retryTask, null);

    await worker.start();
    await Promise.all([retryStarted.promise, failStarted.promise]);
    const claimsAtShutdown = claimCalls;
    const firstStop = worker.stop({ gracePeriodMs: 10 });
    const secondStop = worker.stop({ gracePeriodMs: 1 });

    clock.advanceBy({ milliseconds: 9 });
    await Promise.resolve();
    expect(worker.state).toBe('stopping');
    expect(await cadence.getJob(retryJob.id)).toMatchObject({ status: 'running' });

    clock.advanceBy({ milliseconds: 1 });
    await Promise.all([retryAborted.promise, failAborted.promise, firstStop, secondStop]);

    expect(claimCalls).toBe(claimsAtShutdown);
    expect(await cadence.getJob(retryJob.id)).toMatchObject({
      status: 'pending',
      attempts: 1,
      lastError: { code: 'job.worker-shutdown' },
    });
    expect(await cadence.getJob(failJob.id)).toMatchObject({
      status: 'failed',
      attempts: 1,
      lastError: { code: 'job.worker-shutdown' },
    });
    expect(await cadence.getJob(unclaimedJob.id)).toMatchObject({ status: 'pending', attempts: 0 });
    expect(worker.state).toBe('stopped');
    await worker.stop();
    await expect(worker.start()).rejects.toMatchObject({ code: 'worker.cannot-restart' });
  });

  test('grace expiry is not blocked by a pending heartbeat operation', async () => {
    const clock = createControlledClock({ now: start });
    const backingDriver = memory({ clock });
    const handlerStarted = Promise.withResolvers<void>();
    const handlerAborted = Promise.withResolvers<void>();
    const renewalStarted = Promise.withResolvers<void>();
    const finishRenewal = Promise.withResolvers<void>();
    const renewalFinished = Promise.withResolvers<void>();
    const driver: Driver = {
      ...backingDriver,
      renewJobLeases: async (options) => {
        renewalStarted.resolve();
        await finishRenewal.promise;
        const renewed = await backingDriver.renewJobLeases(options);
        renewalFinished.resolve();
        return renewed;
      },
    };
    const task = defineTask({
      name: 'shutdown.pending-heartbeat',
      schema: v.null(),
      retry: { maxAttempts: 2 },
    });
    const cadence = createCadence({ driver });
    const worker = cadence.createWorker({
      handlers: [
        defineHandler(task, async (_payload, { signal }) => {
          handlerStarted.resolve();
          signal.addEventListener('abort', () => handlerAborted.resolve(), { once: true });
          await new Promise<never>(() => {});
        }),
      ],
      pollingIntervalMs: 100,
      leaseDurationMs: 30,
      heartbeatIntervalMs: 10,
      scheduler: clock,
    });
    const job = await cadence.enqueue(task, null);

    await worker.start();
    await handlerStarted.promise;
    clock.advanceBy({ milliseconds: 10 });
    await renewalStarted.promise;

    const stopping = worker.stop({ gracePeriodMs: 5 });
    clock.advanceBy({ milliseconds: 5 });
    await Promise.all([handlerAborted.promise, stopping]);
    expect(await cadence.getJob(job.id)).toMatchObject({
      status: 'pending',
      lastError: { code: 'job.worker-shutdown' },
    });

    finishRenewal.resolve();
    await renewalFinished.promise;
  });

  test('grace expiry is not blocked by a pending claim operation', async () => {
    const clock = createControlledClock({ now: start });
    const backingDriver = memory({ clock });
    const claimStarted = Promise.withResolvers<void>();
    const finishClaim = Promise.withResolvers<void>();
    const claimFinished = Promise.withResolvers<void>();
    const driver: Driver = {
      ...backingDriver,
      claimJobs: async (options) => {
        claimStarted.resolve();
        await finishClaim.promise;
        const jobs = await backingDriver.claimJobs(options);
        claimFinished.resolve();
        return jobs;
      },
    };
    const task = defineTask({ name: 'shutdown.pending-claim', schema: v.null() });
    const cadence = createCadence({ driver });
    const worker = cadence.createWorker({
      handlers: [defineHandler(task, () => {})],
      pollingIntervalMs: 100,
      leaseDurationMs: 30,
      heartbeatIntervalMs: 10,
      scheduler: clock,
    });

    await worker.start();
    await claimStarted.promise;
    const stopping = worker.stop({ gracePeriodMs: 5 });
    clock.advanceBy({ milliseconds: 5 });

    await stopping;
    expect(worker.state).toBe('stopped');
    finishClaim.resolve();
    await claimFinished.promise;
  });

  test('client close stops all workers before closing the driver and is idempotent', async () => {
    const clock = createControlledClock({ now: start });
    const backingDriver = memory({ clock });
    let closeCalls = 0;
    let statesAtClose: string[] = [];
    let workers: ReturnType<ReturnType<typeof createCadence>['createWorker']>[] = [];
    const driver: Driver = {
      ...backingDriver,
      close: async () => {
        closeCalls += 1;
        statesAtClose = workers.map(({ state }) => state);
        await backingDriver.close();
      },
    };
    const task = defineTask({ name: 'client.close', schema: v.null() });
    const cadence = createCadence({ driver });
    workers = [
      cadence.createWorker({ handlers: [defineHandler(task, () => {})], scheduler: clock }),
      cadence.createWorker({ handlers: [defineHandler(task, () => {})], scheduler: clock }),
    ];
    await workers[0]?.start();

    await cadence.close();
    await cadence.close();

    expect(closeCalls).toBe(1);
    expect(statesAtClose).toEqual(['stopped', 'stopped']);
    expect(workers.map(({ state }) => state)).toEqual(['stopped', 'stopped']);
    await expect(cadence.getJob('missing')).rejects.toMatchObject({ code: 'client.closed' });
    expect(() => cadence.createWorker({ handlers: [] })).toThrowError(
      expect.objectContaining({ code: 'client.closed' }),
    );
  });
});
