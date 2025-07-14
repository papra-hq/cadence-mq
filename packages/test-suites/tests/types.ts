import type { JobRepositoryDriver } from '@cadence-mq/core';

export type TestSuiteArgs = { createDriver: () => Promise<{ driver: JobRepositoryDriver }>; processingLatencyMs?: number };
export type TestSuite = (arg: TestSuiteArgs) => void;
