import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    reporters: ['verbose'],
    passWithNoTests: true,
    projects: ['packages/*', '!packages/test-suites'],
    coverage: {
      include: ['packages/*/src'],
    },
  },
});
