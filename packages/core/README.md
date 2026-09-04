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

## License

[MIT](./LICENSE)
