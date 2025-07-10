import type { Queue } from '@cadence-mq/core';

export type QueueFactory = (arg?: { generateJobId?: () => string }) => Promise<{ queue: Queue }>;
export type TestSuite = (arg: { createQueue: QueueFactory; processingLatencyMs?: number }) => void;
