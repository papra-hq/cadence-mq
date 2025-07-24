import { createCadence } from '@cadence-mq/core';
import { createDrizzleDriver, setupSchema } from '@cadence-mq/driver-drizzle';
import { createClient } from '@libsql/client';
import { drizzle } from 'drizzle-orm/libsql';
import { jobsTable } from './jobs.table';

const client = createClient({ url: ':memory:' });
await setupSchema({ client });

const driver = createDrizzleDriver({ db: drizzle(client), schema: { jobs: jobsTable } });
const cadence = createCadence({ driver });

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
