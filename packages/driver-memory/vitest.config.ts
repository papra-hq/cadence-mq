import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@cadence-mq/core/driver-test': fileURLToPath(
        new URL('../core/src/driver-test.ts', import.meta.url),
      ),
      '@cadence-mq/core': fileURLToPath(new URL('../core/src/index.ts', import.meta.url)),
    },
  },
});
