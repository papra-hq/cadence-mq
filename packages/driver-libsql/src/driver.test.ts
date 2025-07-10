import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createQueue } from '@cadence-mq/core';
import { runTestSuites } from '@cadence-mq/test-suites';
import { createClient } from '@libsql/client';
import { afterAll, beforeAll, describe } from 'vitest';
import { createLibSqlDriver } from './driver';
import { setupSchema } from './migrations';

const TEST_DB_ROOT = path.join(os.tmpdir(), 'cadence-mq-tests-driver-libsql');
const POLL_INTERVAL_MS = 50;

describe('libsql driver', () => {
  describe('with a file-based libsql database', () => {
    beforeAll(async () => {
      await fs.mkdir(TEST_DB_ROOT, { recursive: true });
    });

    afterAll(async () => {
      await fs.rm(TEST_DB_ROOT, { recursive: true });
    });

    runTestSuites({
      createQueue: async (args = {}) => {
        const dbDir = await fs.mkdtemp(path.join(TEST_DB_ROOT, 'cadence-mq-'));
        const dbPath = path.join(dbDir, 'cadence-mq.db');

        const fileUrl = `file:${dbPath}`;

        const client = createClient({ url: fileUrl });
        await setupSchema({ client });

        const driver = createLibSqlDriver({ client, pollIntervalMs: POLL_INTERVAL_MS });
        const queue = createQueue({ driver, ...args });

        return { queue };
      },
      processingLatencyMs: POLL_INTERVAL_MS,
    });
  });
});
