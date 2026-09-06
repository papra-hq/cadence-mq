# @cadence-mq/core

Core task, job, driver, client, and worker contracts for CadenceMQ.

> The v1 API is under active development and is not stable yet.

```ts
import { createCadence, defineHandler, defineTask } from '@cadence-mq/core';
import { memory } from '@cadence-mq/driver-memory';
import * as v from 'valibot';

const greet = defineTask({
  name: 'greet',
  schema: v.object({ name: v.string() }),
});

const cadence = createCadence({ driver: memory() });
const worker = cadence.createWorker({
  handlers: [
    defineHandler(greet, async ({ name }) => {
      await sendGreeting(name);
    }),
  ],
});

await cadence.enqueue(greet, { name: 'Ada' });
await worker.start();

// Stops this client's workers before closing its driver.
await cadence.close();
```

## Overdue schedules

When a schedule is overdue, the worker creates one job for its persisted `nextRunAt` and
atomically advances the cursor to the first cron occurrence strictly after the driver's claim
time. Intervening missed ticks are skipped, not replayed or searched for the latest occurrence.
Scheduling work does not grow with the number of missed ticks.

## Testing a driver

Driver implementations can run the shared high-level behavioral suite from the dedicated test
entry point:

```ts
import { runDriverTestSuite } from '@cadence-mq/core/driver-test';
import { describe } from 'vitest';

describe('custom driver', () => {
  runDriverTestSuite({
    createDriver: () => createCustomDriver(),
  });
});
```

The factory must return a fresh, isolated driver for each test. The suite closes each driver when
the scenario finishes.

## License

[MIT](./LICENSE)
