import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // The package is intentionally empty while the rewrite is bootstrapped.
    passWithNoTests: true,
  },
});
