import { runTestSuites } from '@cadence-mq/test-suites';
import { describe } from 'vitest';
import { createMemoryDriver } from './driver';

describe('memory driver', () => {
  runTestSuites({
    createDriver: async () => ({ driver: createMemoryDriver() }),
  });
});
