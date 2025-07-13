import { createCadence } from '@cadence-mq/core';
import { createLibSqlDriver, setupSchema } from '@cadence-mq/driver-libsql';
import { createClient } from '@libsql/client';

const client = createClient({ url: ':memory:' });
const driver = createLibSqlDriver({ client });
const cadence = createCadence({ driver });

// Setup the schema for the database, can be done once at startup
await setupSchema({ client });

// Register a task to be executed
cadence.registerTask({
  taskName: 'send-welcome-email',
  handler: async ({ data }) => {
    console.log(`Sending welcome email to ${data.email}`);
  },
});

// Create a worker to execute the jobs
const worker = cadence.createWorker({ workerId: '1' });
worker.start();

// Schedule a job to be executed as soon as possible
await cadence.scheduleJob({
  taskName: 'send-welcome-email',
  data: { email: 'test@test.com' },
});
