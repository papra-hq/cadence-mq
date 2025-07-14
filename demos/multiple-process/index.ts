import { fork } from 'node:child_process';
import os from 'node:os';
import { getCadence } from './shared';

// Schedule a job to be executed as soon as possible
const cadence = await getCadence();

const count = os.availableParallelism();

console.log(`Starting ${count} workers`);

for (let i = 0; i < count; i++) {
  const worker = fork('./multiple-process/worker.ts');

  worker.on('exit', (code) => {
    console.log(`Worker ${i} exited with code ${code}`);
  });
};

setInterval(() => {
  cadence.scheduleJob({
    taskName: 'send-welcome-email',
    data: { email: 'test@test.com' },
  });
}, 500);
