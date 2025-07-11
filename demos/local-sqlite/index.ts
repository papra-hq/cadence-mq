import { createCadence } from '@cadence-mq/core';
import { createLibSqlDriver } from '@cadence-mq/driver-libsql';
import { createClient } from '@libsql/client';

const driver = createLibSqlDriver({ client: createClient({ url: ':memory:' }) });

const cadence = createCadence({ driver });

cadence.registerTask({
  taskName: 'send-welcome-email',
  handler: async ({ data }) => {
    console.log('Sending welcome email to', (data as { email: string }).email);
  },
});

const worker = cadence.createWorker({ workerId: '1' });

worker.start();

cadence.scheduleJob({
  taskName: 'send-welcome-email',
  data: { email: 'test@test.com' },
});
