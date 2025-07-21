import type { Database } from './database/database.types';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { runTestSuites } from '@cadence-mq/test-suites';
import SQLite from 'better-sqlite3';
import { Kysely, SqliteDialect } from 'kysely';
import { afterAll, beforeAll, describe } from 'vitest';
import { createSqlDriver } from './driver';
import { executeMigrations } from './migrations/migrations';
import * as setupSqliteSchemaMigration from './migrations/sqlite.migration';

const TEST_DB_ROOT = path.join(os.tmpdir(), 'cadence-mq-tests-driver-sql');
const POLL_INTERVAL_MS = 1_000;

describe('kysely driver', () => {
  describe('with a file-based sqlite database', () => {
    beforeAll(async () => {
      await fs.mkdir(TEST_DB_ROOT, { recursive: true });
    });

    afterAll(async () => {
      await fs.rm(TEST_DB_ROOT, { recursive: true });
    });

    runTestSuites({
      createDriver: async () => {
        const dbDir = await fs.mkdtemp(path.join(TEST_DB_ROOT, 'cadence-mq-'));
        const dbPath = path.join(dbDir, 'cadence-mq.db');

        const dialect = new SqliteDialect({
          database: new SQLite(dbPath),
        });

        const client = new Kysely<Database>({ dialect });

        await executeMigrations({ client, getMigrations: async () => ({ setupSqliteSchemaMigration }) });

        const driver = createSqlDriver({ client, pollIntervalMs: POLL_INTERVAL_MS });

        return { driver };
      },
      processingLatencyMs: POLL_INTERVAL_MS,
    });
  });

  describe('with a memory-based sqlite database', () => {
    runTestSuites({
      createDriver: async () => {
        const dialect = new SqliteDialect({
          database: new SQLite(':memory:'),
        });

        const client = new Kysely<Database>({ dialect });

        await executeMigrations({ client, getMigrations: async () => ({ setupSqliteSchemaMigration }) });

        const driver = createSqlDriver({ client, pollIntervalMs: POLL_INTERVAL_MS });

        return { driver };
      },
      processingLatencyMs: POLL_INTERVAL_MS,
    });
  });
});
