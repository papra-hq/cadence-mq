import { defineConfig } from 'tsdown';

export default defineConfig({
  entry: {
    'index': './src/index.ts',
    'driver-test': './src/driver/test/driver-test.ts',
  },
  clean: true,
  exports: true,
  dts: {
    generator: 'oxc',
  },
  deps: {
    neverBundle: ['valibot'],
  },
});
