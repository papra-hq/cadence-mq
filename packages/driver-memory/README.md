# @cadence-mq/driver-memory

Memory driver for Cadence MQ.

## Installation

```bash
pnpm add @cadence-mq/core @cadence-mq/driver-memory
```

## Usage

```typescript
import { createQueue } from '@cadence-mq/core';
import { createMemoryDriver } from '@cadence-mq/driver-memory';

const queue = createQueue({ driver: createMemoryDriver() });

queue.registerTask({
  name: 'my-job',
  handler: async ({ data }) => {
    console.log(data);
  },
});

queue.startWorker({ workerId: 'my-worker' });

await queue.scheduleJob({
  taskName: 'my-job',
  data: {
    message: 'Hello, world!',
  },
});
```

## Credits

Part of [Papra](https://papra.app) ecosystem, and coded with ❤️ by [Corentin Thomasset](https://corentin.tech).

## License

This project is under the [MIT license](LICENSE).
