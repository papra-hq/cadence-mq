import { createClient } from '@libsql/client';
import { describe, expect, test } from 'vitest';
import { setupSchema } from './migrations';

describe('migrations', () => {
  describe('runMigrations', () => {
    test('the migration create a "jobs" table and an index on "status" and "schedule_at"', async () => {
      const client = createClient({ url: ':memory:' });

      await setupSchema({ client });

      const { rows: jobsRows } = await client.execute('SELECT * FROM jobs;');
      expect(jobsRows).to.eql([]);

      const { rows } = await client.execute('SELECT * FROM sqlite_master;');

      const tables = rows.filter(row => row.type === 'table').map(row => row.name);
      expect(tables).to.eql(['jobs']);

      const indexes = rows.filter(row => row.type === 'index').map(row => row.name);
      expect(indexes).to.eql([
        'sqlite_autoindex_jobs_1', // auto-generated index for the primary key
        'jobs_status_schedule_at_started_at_idx',
      ]);
    });
  });
});
