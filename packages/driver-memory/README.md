# @cadence-mq/driver-memory

Process-local in-memory driver for CadenceMQ. It supports an injected clock for deterministic tests.

```ts
import { createCadence, createControlledClock } from '@cadence-mq/core';
import { memory } from '@cadence-mq/driver-memory';

const clock = createControlledClock();
const cadence = createCadence({ driver: memory({ clock }) });
```

## License

[MIT](./LICENSE)
