import type { TestSuite } from './types';
import { testFailingJobs } from './suites/failing-jobs.test';
import { testGettingJobs } from './suites/getting-jobs.test';
import { testImmediateJobs } from './suites/immediate-jobs.test';
import { testScheduledJobs } from './suites/scheduled-jobs.test';

export const runTestSuites: TestSuite = (args) => {
  testImmediateJobs(args);
  testScheduledJobs(args);
  testGettingJobs(args);
  testFailingJobs(args);
};
