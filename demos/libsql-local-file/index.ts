import { createCadence } from '@cadence-mq/core';
import { createLibSqlDriver } from '@cadence-mq/driver-libsql';
import { createClient } from '@libsql/client';

const fileUrl = 'file:./cadence-mq.db';

const client = createClient({ url: fileUrl });
const driver = createLibSqlDriver({ client });
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
cadence.scheduleJob({
  taskName: 'send-welcome-email',
  data: { email: 'test@test.com' },
});
