import { defineConfig } from 'tsdown';

export default defineConfig({
  entry: ['./src/index.ts', './src/utils'],
  clean: true,
  exports: true, // auto update the package.json exports, main, module and types fields
});
