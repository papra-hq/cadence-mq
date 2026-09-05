import type { DriverTestSuiteContext, DriverTestSuiteOptions } from './types';
import { describe } from 'vitest';
import { registerJobsTestSuite } from './jobs.test-suite';
import { registerPruningTestSuite } from './pruning.test-suite';
import { registerSchedulesTestSuite } from './schedules.test-suite';
import { registerWorkersTestSuite } from './workers.test-suite';

export type { DriverTestSuiteOptions } from './types';

/** Registers high-level behavioral tests for a Cadence driver. */
export function runDriverTestSuite({ createDriver, timeout }: DriverTestSuiteOptions): void {
  const context: DriverTestSuiteContext = {
    createDriver,
    testOptions: timeout === undefined ? {} : { timeout },
  };

  describe('high-level driver behavior', () => {
    registerJobsTestSuite(context);
    registerWorkersTestSuite(context);
    registerSchedulesTestSuite(context);
    registerPruningTestSuite(context);
  });
}
