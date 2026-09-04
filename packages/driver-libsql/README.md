# @cadence-mq/driver-libsql

Durable LibSQL driver for CadenceMQ.

```ts
import { createCadence } from '@cadence-mq/core';
import { libsql } from '@cadence-mq/driver-libsql';

const cadence = createCadence({
  driver: libsql({ url: 'file:cadence.db' }),
});
```

Initialization creates the Cadence-owned tables with a forward-only migration.

## License

[MIT](./LICENSE)
