import { createQueue } from '@cadence-mq/core';
import { createLibSqlDriver, setupSchema } from '@cadence-mq/driver-libsql';
import { createClient } from '@libsql/client';

const client = createClient({ url: 'file:./cadence-mq.db' });
// Run migrations to create the database schema
await setupSchema({ client });

const queue = createQueue({ driver: createLibSqlDriver({ client }) });

queue.registerTask({
  name: 'send-welcome-email',
  handler: async ({ data }) => {
    console.log('Sending welcome email to', (data as { email: string }).email);
  },
});

queue.startWorker({ workerId: '1' });

setInterval(async () => {
  await queue.scheduleJob({
    taskName: 'send-welcome-email',
    data: { email: 'test@test.com' },
  });
}, 50);
