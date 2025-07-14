import type { TestSuiteArgs } from './types';
import { testFailingJobs } from './suites/failing-jobs.test';
import { testGettingJobs } from './suites/getting-jobs.test';
import { testImmediateJobs } from './suites/immediate-jobs.test';
import { testJobCount } from './suites/job-count.test';
import { testMultipleWorkers } from './suites/multiple-workers.test';
import { testPeriodicTasks } from './suites/periodic-jobs.test';
import { testScheduledJobs } from './suites/scheduled-jobs.test';

const suites = {
  testImmediateJobs,
  testScheduledJobs,
  testGettingJobs,
  testFailingJobs,
  testMultipleWorkers,
  testJobCount,
  testPeriodicTasks,
};

export function runTestSuites({ exclude = [], ...args }: (TestSuiteArgs & { exclude?: (keyof typeof suites)[] })) {
  Object
    .entries(suites)
    .filter(([key]) => !exclude.includes(key as keyof typeof suites))
    .forEach(([, suite]) => suite(args));
}
