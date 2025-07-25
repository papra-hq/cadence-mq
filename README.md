<p align="center">
<picture>
    <source srcset="./.github/icon-dark.png" media="(prefers-color-scheme: light)">
    <source srcset="./.github/icon-light.png" media="(prefers-color-scheme: dark)">
    <img src="./.github/icon-dark.png" alt="Header banner">
</picture>
</p>

<h1 align="center">
  CadenceMQ - Job scheduling library
</h1>
<p align="center">
  CadenceMQ is a job scheduling library for Node.js. It is designed to be easy to use, flexible, and scalable.
</p>


> [!NOTE]
> This is a work in progress, anything can change at any time.

## Features

- [x] Job scheduling
- [x] Retry mechanism
- [x] Periodic jobs
- [ ] Job status tracking
- [ ] UI for monitoring and managing jobs
- [ ] Unique key for jobs
- [ ] Drivers for different backends
  - [x] SQLite/LibSQL (in-memory, remote server or file-based)
  - [x] Native in-memory
  - [ ] Redis
  - [ ] MongoDB

## Why another job scheduling library?

There are many job scheduling libraries of quality, but most of them are tied to a specific backend, like BullMQ with Redis or Agenda with MongoDB.
CadenceMQ is designed to be **backend agnostic**, and can be used with different backends, the motivation is to provide a simple simple for self-hostable applications but being able to scale horizontally in production environments.

This as been initially created for [Papra](https://papra.app), a self-hostable minimalistic document management platform, as we didn't want the self-hosters to have to setup a Redis.

## Getting started

Basic example using LibSQL/SQLite as backend:

```bash
# using pnpm
pnpm install @cadence-mq/core @cadence-mq/driver-libsql

# using bun
bun add @cadence-mq/core @cadence-mq/driver-libsql

# using npm
npm install @cadence-mq/core @cadence-mq/driver-libsql

# using yarn
yarn add @cadence-mq/core @cadence-mq/driver-libsql
```


```ts
import { createCadence } from '@cadence-mq/core';
import { createLibSqlDriver } from '@cadence-mq/driver-libsql';
import { createClient } from '@libsql/client';
import { z } from 'zod';

const driver = createLibSqlDriver({ client: createClient({ url: ':memory:' }) });

const cadence = createCadence({ driver });

cadence.registerTask({
  taskName: 'send-welcome-email',
  handler: async ({ data }) => {
    console.log('Sending welcome email to', (data as { email: string }).email);
  },
});

const worker = cadence.createWorker({ workerId: '1' });

worker.start();

await cadence.scheduleJob({
  taskName: 'send-welcome-email',
  data: { email: 'test@test.com' },
});

```

## Examples

- [Local SQLite](./demos/local-sqlite/index.ts)

## Contributing

Contributions are welcome! Please refer to the [`CONTRIBUTING.md`](./CONTRIBUTING.md) file for guidelines on how to get started, report issues, and submit pull requests.

## Credits

This project is crafted with ❤️ by [Corentin Thomasset](https://corentin.tech).
If you find this project helpful, please consider [supporting my work](https://buymeacoffee.com/cthmsst).

## Acknowledgements

CadenceMQ is inspired by some great projects:

- [Agenda](https://github.com/agenda/agenda), a task runner and scheduler based on MongoDB.
- [Pulse](https://github.com/pulsecron/pulse), a fork of Agenda with extended features.
- [BullMQ](https://github.com/taskforcesh/bullmq), a message queue and batch processing for NodeJS and Python based on Redis.
- [Plainjob](https://github.com/justplainstuff/plainjob), a SQLite-backed job queue.
- [A SQLite Background Job System](https://jasongorman.uk/writing/sqlite-background-job-system/), an article by [Jason Gorman](https://github.com/jasongormanuk/).