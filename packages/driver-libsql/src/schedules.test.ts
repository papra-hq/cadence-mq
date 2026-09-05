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
  test.each([
    { label: 'without schedule columns', scheduleColumns: '' },
    {
      label: 'with pre-provisioned schedule columns',
      scheduleColumns: 'schedule_id TEXT, schedule_occurrence_at INTEGER,',
    },
  ])('a v1 database $label migrates without losing existing jobs', async ({ scheduleColumns }) => {
    const seedClient = createClient({ url, timeout: 5_000 });
    clients.push(seedClient);
    await seedClient.batch(
      [
        `CREATE TABLE cadence_migrations (version INTEGER PRIMARY KEY, applied_at INTEGER NOT NULL)`,
        `INSERT INTO cadence_migrations (version, applied_at) VALUES (1, 0)`,
        `CREATE TABLE cadence_jobs (
          id TEXT PRIMARY KEY,
          task_name TEXT NOT NULL,
          payload TEXT NOT NULL,
          status TEXT NOT NULL CHECK (status IN ('pending', 'running', 'succeeded', 'failed')),
          attempts INTEGER NOT NULL,
          retry_json TEXT NOT NULL,
          max_attempts INTEGER NOT NULL,
          created_at INTEGER NOT NULL,
          available_at INTEGER NOT NULL,
          started_at INTEGER,
          finished_at INTEGER,
          last_error TEXT,
          ${scheduleColumns}
          lease_token TEXT,
          lease_expires_at INTEGER
        )`,
        {
          sql: `INSERT INTO cadence_jobs (
            id, task_name, payload, status, attempts, retry_json, max_attempts,
            created_at, available_at
          ) VALUES (?, ?, ?, 'pending', 0, ?, 1, ?, ?)`,
          args: [
            'legacy-job',
            'reports.create',
            JSON.stringify({ legacy: true }),
            JSON.stringify({ maxAttempts: 1 }),
            1_767_225_600_000,
            1_767_225_600_000,
          ],
        },
      ],
      'write',
    );

    const target = driver();
    const concurrentTarget = driver();
    await Promise.all([target.initialize(), concurrentTarget.initialize()]);
    expect(await target.getJob('legacy-job')).toMatchObject({
      id: 'legacy-job',
      payload: { legacy: true },
    });
    const migratedSchedule = await target.upsertSchedule(await schedule(target));
    expect((await target.getSchedule(migratedSchedule.id))?.id).toBe('reports.daily');
  });

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
