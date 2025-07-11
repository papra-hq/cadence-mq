import type { JobRepositoryDriver } from '@cadence-mq/core';

export type TestSuite = (arg: { createDriver: () => Promise<{ driver: JobRepositoryDriver }>; processingLatencyMs?: number }) => void;
