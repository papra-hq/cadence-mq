import { defineConfig } from 'tsdown';

export default defineConfig({
  entry: ['./src/index.ts'],
  clean: true,
  exports: true,
  dts: {
    generator: 'oxc',
  },
  deps: {
    neverBundle: ['@cadence-mq/core', '@libsql/client'],
  },
});
