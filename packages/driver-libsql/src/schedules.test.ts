import type { Driver, NewJob, ScheduleUpsert } from '@cadence-mq/core';
import type { Client } from '@libsql/client';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { createClient } from '@libsql/client';
import { createLibsqlDriver } from './libsql-driver';

let directory: string;
let url: string;
let clients: Client[];

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'cadence-libsql-schedules-'));
  url = `file:${join(directory, 'queue.db')}`;
  clients = [];
});

afterEach(async () => {
  for (const client of clients) client.close();
  await rm(directory, { recursive: true, force: true });
});

function driver(): Driver {
  const client = createClient({ url, timeout: 5_000 });
  clients.push(client);
  return createLibsqlDriver({ client });
}

async function schedule(target: Driver, overrides: Partial<ScheduleUpsert> = {}) {
  return {
    id: 'reports.daily',
    taskName: 'reports.create',
    payload: { report: true },
    retry: { maxAttempts: 1 },
    trigger: { cron: '* * * * *', timeZone: 'UTC' },
    nextRunAt: await target.now(),
    ...overrides,
  } satisfies ScheduleUpsert;
}

function occurrence(id: string, occurrenceAt: Temporal.Instant): NewJob {
  return {
    id,
    taskName: 'reports.create',
    payload: { report: true },
    retry: { maxAttempts: 1 },
    availableAt: occurrenceAt,
    schedule: { id: 'reports.daily', occurrenceAt },
  };
}

describe('LibSQL schedules', () => {
  test('independent clients cannot claim or materialize one occurrence twice', async () => {
    const first = driver();
    const second = driver();
    await Promise.all([first.initialize(), second.initialize()]);
    await first.upsertSchedule(await schedule(first));

    const [firstClaims, secondClaims] = await Promise.all([
      first.claimDueSchedules({ limit: 1, leaseDurationMs: 30_000 }),
      second.claimDueSchedules({ limit: 1, leaseDurationMs: 30_000 }),
    ]);
    expect([...firstClaims, ...secondClaims]).toHaveLength(1);
    const initialOwner = firstClaims.length === 1 ? first : second;
    const reclaimOwner = initialOwner === first ? second : first;
    const [activeClaim] = [...firstClaims, ...secondClaims];
    if (activeClaim === undefined) throw new Error('Expected an active claim');

    expect(await initialOwner.claimDueSchedules({ limit: 1, leaseDurationMs: 0 })).toEqual([]);
    await initialOwner.releaseScheduleClaim({
      id: activeClaim.id,
      token: activeClaim.leaseToken,
    });
    const [expiredClaim] = await initialOwner.claimDueSchedules({
      limit: 1,
      leaseDurationMs: 0,
    });
    const [currentClaim] = await reclaimOwner.claimDueSchedules({
      limit: 1,
      leaseDurationMs: 30_000,
    });
    if (expiredClaim === undefined || currentClaim === undefined) {
      throw new Error('Expected expired and current claims');
    }
    const nextRunAt = currentClaim.nextRunAt.add({ minutes: 1 });

    const [staleResult, currentResult] = await Promise.all([
      initialOwner.commitScheduleOccurrence({
        lease: { id: expiredClaim.id, token: expiredClaim.leaseToken },
        job: occurrence('stale-occurrence', expiredClaim.nextRunAt),
        nextRunAt,
      }),
      reclaimOwner.commitScheduleOccurrence({
        lease: { id: currentClaim.id, token: currentClaim.leaseToken },
        job: occurrence('current-occurrence', currentClaim.nextRunAt),
        nextRunAt,
      }),
    ]);

    expect(staleResult).toBe(false);
    expect(currentResult).toBe(true);
    expect(await initialOwner.getJob('stale-occurrence')).toBeUndefined();
    expect(await initialOwner.getJob('current-occurrence')).toMatchObject({
      schedule: { id: currentClaim.id, occurrenceAt: currentClaim.nextRunAt },
    });
    expect((await initialOwner.getSchedule(currentClaim.id))?.nextRunAt.equals(nextRunAt)).toBe(
      true,
    );
  });
});
