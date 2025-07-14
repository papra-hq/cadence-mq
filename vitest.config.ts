import { defineConfig } from 'vitest/config'

export default defineConfig({

  test: {
    reporters: ['verbose'],
    projects: ['packages/*', '!packages/test-suites'],
    coverage: {
      include: ['packages/*/src'],
    }
  },
})