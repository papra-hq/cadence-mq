import type { Migration } from 'kysely';
import type { DatabaseClient } from '../database/database.types';
import { Migrator } from 'kysely';

export async function executeMigrations({ client, getMigrations }: { client: DatabaseClient; getMigrations: () => Promise<Record<string, Migration>> }) {
  const migrator = new Migrator({
    db: client,
    provider: {
      getMigrations,
    },
  });

  const { error } = await migrator.migrateToLatest();

  if (error) {
    throw error;
  }
}
