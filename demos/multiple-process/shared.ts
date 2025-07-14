import { createCadence } from '@cadence-mq/core';
import { createLibSqlDriver, setupSchema } from '@cadence-mq/driver-libsql';
import { createClient } from '@libsql/client';

const fileUrl = 'file:./cadence-mq.db';

const client = createClient({ url: fileUrl });
const driver = createLibSqlDriver({ client });

export async function getCadence() {
  const cadence = createCadence({ driver });
  await setupSchema({ client });
  return cadence;
}
