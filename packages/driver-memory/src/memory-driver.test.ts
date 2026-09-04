import type { Driver, Job, JsonValue, LeaseRef, NewJob } from '@cadence-mq/core';
import { describe, expect, test } from 'vitest';
import * as v from 'valibot';
import { createCadence, createControlledClock, defineHandler, defineTask } from '@cadence-mq/core';
import { memory } from './memory-driver';

const start = Temporal.Instant.from('2026-01-01T00:00:00Z');

function newJob({
  id,
  payload = { id },
  availableAt = start,
  maxAttempts = 2,
  taskName = 'email.send',
}: {
  id: string;
  payload?: JsonValue;
  availableAt?: Temporal.Instant;
  maxAttempts?: number;
  taskName?: string;
}): NewJob {
  return {
    id,
    taskName,
    payload,
    retry: { maxAttempts },
    availableAt,
  };
}

describe('memory driver', () => {
  test('payloads are isolated from input and returned-record mutation', async () => {
    const clock = createControlledClock({ now: start });
    const driver = memory({ clock });
    const payload = { nested: { value: 'original' } };

    const inserted = await driver.insertJob(newJob({ id: 'job-1', payload }));
    payload.nested.value = 'input mutation';
    (inserted.payload as typeof payload).nested.value = 'return mutation';

    const persisted = await driver.getJob('job-1');
    expect(persisted?.payload).toEqual({ nested: { value: 'original' } });
  });

  test('only jobs available at the controlled time are claimed', async () => {
    const clock = createControlledClock({ now: start });
    const driver = memory({ clock });
    const cadence = createCadence({ driver });
    const task = defineTask({ name: 'email.send', schema: v.object({ id: v.string() }) });
    const immediate = await cadence.enqueue(task, { id: 'immediate' });
    const delayed = await cadence.enqueue(
      task,
      { id: 'delayed' },
      { runAt: start.add({ hours: 1 }) },
    );

    const immediateClaims = await driver.claimJobs({
      taskNames: ['email.send'],
      limit: 2,
      leaseDurationMs: 30_000,
    });
    expect(immediateClaims.map(({ id }) => id)).toEqual([immediate.id]);
    expect((await cadence.getJob(delayed.id))?.status).toBe('pending');
    expect(
      await driver.completeJob({
        id: immediate.id,
        token: immediateClaims[0]?.leaseToken ?? '',
      }),
    ).toBe(true);

    clock.advanceBy({ hours: 1 });
    const delayedClaims = await driver.claimJobs({
      taskNames: ['email.send'],
      limit: 2,
      leaseDurationMs: 30_000,
    });
    expect(delayedClaims.map(({ id }) => id)).toEqual([delayed.id]);
  });

  test('concurrent workers receive at most one active lease for a job', async () => {
    const clock = createControlledClock({ now: start });
    const driver = memory({ clock });
    await driver.insertJob(newJob({ id: 'job-1' }));

    const [firstWorker, secondWorker] = await Promise.all([
      driver.claimJobs({ taskNames: ['email.send'], limit: 1, leaseDurationMs: 30_000 }),
      driver.claimJobs({ taskNames: ['email.send'], limit: 1, leaseDurationMs: 30_000 }),
    ]);

    expect([...firstWorker, ...secondWorker]).toHaveLength(1);
    expect([...firstWorker, ...secondWorker][0]).toMatchObject({
      id: 'job-1',
      status: 'running',
      attempts: 1,
    });
    expect([...firstWorker, ...secondWorker][0]?.leaseToken).toEqual(expect.any(String));
  });

  test('a stale fencing token cannot complete a reclaimed job', async () => {
    const clock = createControlledClock({ now: start });
    const driver = memory({ clock });
    await driver.insertJob(newJob({ id: 'job-1', maxAttempts: 2 }));

    const [firstClaim] = await driver.claimJobs({
      taskNames: ['email.send'],
      limit: 1,
      leaseDurationMs: 1_000,
    });
    clock.advanceBy({ milliseconds: 1_000 });
    const [secondClaim] = await driver.claimJobs({
      taskNames: ['email.send'],
      limit: 1,
      leaseDurationMs: 1_000,
    });

    expect(firstClaim).toBeDefined();
    expect(secondClaim).toBeDefined();
    expect(secondClaim?.leaseToken).not.toBe(firstClaim?.leaseToken);
    expect(await driver.completeJob({ id: 'job-1', token: firstClaim?.leaseToken ?? '' })).toBe(
      false,
    );
    expect(await driver.getJob('job-1')).toMatchObject({ status: 'running', attempts: 2 });
    expect(await driver.completeJob({ id: 'job-1', token: secondClaim?.leaseToken ?? '' })).toBe(
      true,
    );
  });

  test('getJob observes pending, running, and succeeded transitions', async () => {
    const clock = createControlledClock({ now: start });
    const driver = memory({ clock });
    await driver.insertJob(newJob({ id: 'job-1' }));

    expect(await driver.getJob('job-1')).toMatchObject({ status: 'pending', attempts: 0 });
    const [claim] = await driver.claimJobs({
      taskNames: ['email.send'],
      limit: 1,
      leaseDurationMs: 30_000,
    });
    expect(await driver.getJob('job-1')).toMatchObject({
      status: 'running',
      attempts: 1,
      startedAt: start,
    });

    expect(await driver.completeJob({ id: 'job-1', token: claim?.leaseToken ?? '' })).toBe(true);
    expect(await driver.getJob('job-1')).toMatchObject({
      status: 'succeeded',
      attempts: 1,
      finishedAt: start,
    });
    expect(await driver.getJob('missing')).toBeUndefined();
  });

  test('due jobs are ordered by availability, creation time, and ID', async () => {
    const clock = createControlledClock({ now: start });
    const driver = memory({ clock });
    await driver.insertJob(newJob({ id: 'c', availableAt: start.subtract({ milliseconds: 1 }) }));
    await driver.insertJob(newJob({ id: 'b' }));
    await driver.insertJob(newJob({ id: 'a' }));

    const claims = await driver.claimJobs({
      taskNames: ['email.send'],
      limit: 3,
      leaseDurationMs: 30_000,
    });

    expect(claims.map(({ id }) => id)).toEqual(['c', 'a', 'b']);
  });

  test('an expired final lease becomes failed instead of being reclaimed', async () => {
    const clock = createControlledClock({ now: start });
    const driver = memory({ clock });
    await driver.insertJob(newJob({ id: 'job-1', maxAttempts: 1 }));
    await driver.claimJobs({ taskNames: ['email.send'], limit: 1, leaseDurationMs: 1_000 });

    clock.advanceBy({ milliseconds: 1_000 });
    const claims = await driver.claimJobs({
      taskNames: ['email.send'],
      limit: 1,
      leaseDurationMs: 1_000,
    });

    expect(claims).toEqual([]);
    expect(await driver.getJob('job-1')).toMatchObject({
      status: 'failed',
      attempts: 1,
      lastError: { code: 'job.lease-expired' },
    });
  });

  test('renewing a current lease keeps it active past its original expiry', async () => {
    const clock = createControlledClock({ now: start });
    const driver = memory({ clock });
    await driver.insertJob(newJob({ id: 'job-1', maxAttempts: 2 }));
    const [claim] = await driver.claimJobs({
      taskNames: ['email.send'],
      limit: 1,
      leaseDurationMs: 1_000,
    });
    const lease = { id: 'job-1', token: claim?.leaseToken ?? '' };

    clock.advanceBy({ milliseconds: 500 });
    expect(await driver.renewJobLeases({ leases: [lease], leaseDurationMs: 1_000 })).toEqual([
      'job-1',
    ]);

    clock.advanceBy({ milliseconds: 500 });
    expect(
      await driver.claimJobs({
        taskNames: ['email.send'],
        limit: 1,
        leaseDurationMs: 1_000,
      }),
    ).toEqual([]);

    clock.advanceBy({ milliseconds: 500 });
    const [reclaimed] = await driver.claimJobs({
      taskNames: ['email.send'],
      limit: 1,
      leaseDurationMs: 1_000,
    });
    expect(reclaimed).toMatchObject({ id: 'job-1', attempts: 2 });
    expect(await driver.renewJobLeases({ leases: [lease], leaseDurationMs: 1_000 })).toEqual([]);
    expect(
      await driver.renewJobLeases({
        leases: [lease, { id: 'job-1', token: reclaimed?.leaseToken ?? '' }],
        leaseDurationMs: 1_000,
      }),
    ).toEqual(['job-1']);
  });

  test('retry and failure transitions reject stale fencing tokens', async () => {
    const clock = createControlledClock({ now: start });
    const driver = memory({ clock });
    await driver.insertJob(newJob({ id: 'retry', maxAttempts: 2 }));
    await driver.insertJob(newJob({ id: 'fail', maxAttempts: 1 }));
    const claims = await driver.claimJobs({
      taskNames: ['email.send'],
      limit: 2,
      leaseDurationMs: 1_000,
    });
    const retryClaim = claims.find(({ id }) => id === 'retry');
    const failClaim = claims.find(({ id }) => id === 'fail');
    const error = { name: 'AbortError', message: 'worker stopped', code: 'job.worker-shutdown' };

    expect(
      await driver.retryJob({
        lease: { id: 'retry', token: retryClaim?.leaseToken ?? '' },
        error,
        delayMs: 500,
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

    expect(await driver.getJob('retry')).toMatchObject({
      status: 'pending',
      availableAt: start.add({ milliseconds: 500 }),
      lastError: error,
    });
    expect(await driver.getJob('fail')).toMatchObject({
      status: 'failed',
      finishedAt: start,
      lastError: error,
    });
  });

  test('closing the driver repeatedly is safe', async () => {
    const driver = memory();

    await driver.close();
    await driver.close();
  });
});

describe('fundamental queue path', () => {
  test('define, enqueue, claim, execute, complete, and inspect reaches succeeded', async () => {
    const clock = createControlledClock({ now: start });
    const backingDriver = memory({ clock });
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
    expect(job.status).toBe('pending');

    await worker.start();
    await completion.promise;
    await worker.stop();

    expect(received).toEqual([{ recipient: 'jane@example.com' }]);
    expect(await cadence.getJob(job.id)).toMatchObject({
      id: job.id,
      taskName: 'email.send',
      status: 'succeeded',
      attempts: 1,
    } satisfies Partial<Job>);
  });
});
