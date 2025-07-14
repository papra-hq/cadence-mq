import { createCadence } from '@cadence-mq/core';
import { createMemoryDriver } from '@cadence-mq/driver-memory';
import * as v from 'valibot';

const driver = createMemoryDriver();
const cadence = createCadence({ driver });

// Register a task to be executed
cadence.registerTask({
  taskName: 'greet',
  schema: {
    data: v.object({
      email: v.pipe(v.string(), v.email()),
      name: v.optional(v.string(), 'Ahsoka Tano'),
    }),
  },
  handler: async ({ data }) => {
    console.log(`Greeting ${data.name} with email ${data.email}`);
  },
});

// Create a worker to execute the jobs
const worker = cadence.createWorker({ workerId: '1' });
worker.start();

// Schedule a job to be executed as soon as possible
// Now this is strongly typed - taskName must be 'send-welcome-email' and data must match the schema
await cadence.scheduleJob({
  taskName: 'greet',
  data: {
    email: 'ahsoka@cadence.mq',
  },
});

try {
  // This would cause a validation error
  await cadence.scheduleJob({
    taskName: 'greet',
    data: {
      email: 'hello',
    },
  });
} catch (error) {
  console.error(error);
}
