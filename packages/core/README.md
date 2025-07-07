# @cadence-mq/core

Core library for Cadence MQ.

## Installation

```bash
pnpm add @cadence-mq/core @cadence-mq/driver-libsql @libsql/client
```

## Usage

```typescript
import { createQueue } from '@cadence-mq/core';
import { createLibSqlDriver } from '@cadence-mq/driver-libsql';
import { createClient } from '@libsql/client';

const client = createClient({
  url: 'file:./cadence-mq.db',
});

const driver = createLibSqlDriver({ client });
const queue = createQueue({ driver });

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
