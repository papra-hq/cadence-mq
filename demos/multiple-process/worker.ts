import { getCadence } from './shared';

const cadence = await getCadence();

const workerId = process.pid.toString();

cadence.registerTask({
  taskName: 'send-welcome-email',
  handler: async ({ data, context }) => {
    console.log(`Sending welcome email to ${data.email} from worker ${context.workerId}`);
  },
});

const worker = cadence.createWorker({ workerId });
worker.start();

console.log(`Worker ${workerId} started`);
