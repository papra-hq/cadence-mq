import { createCadence } from '@cadence-mq/core';
import { createMemoryDriver } from '@cadence-mq/driver-memory';

const driver = createMemoryDriver();
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
