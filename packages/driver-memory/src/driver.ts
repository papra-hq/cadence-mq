import type { Job, JobRepositoryDriver } from '@cadence-mq/core';
import { createJobNotFoundError, createJobWithSameIdExistsError } from './errors';

function getNextJob({ jobsRegistry, processingExpiresAt }: { jobsRegistry: Map<string, Job>; processingExpiresAt: Date }) {
  let nextJob: Job | null = null;

  const isJobSelectable = (job: Job) => job.status === 'pending' || (job.status === 'processing');
  const isJobScheduledEarlier = (job: Job) =>
    nextJob === null
    || (job.status === 'pending' && job.scheduleAt < nextJob.scheduleAt)
    || (job.status === 'processing' && job.startedAt && job.startedAt < processingExpiresAt);

  for (const job of jobsRegistry.values()) {
    if (isJobSelectable(job) && isJobScheduledEarlier(job)) {
      nextJob = job;
    }
  }

  return nextJob;
}

export function createMemoryDriver(): JobRepositoryDriver {
  const jobsRegistry = new Map<string, Job>();
  const pendingResolvers: ((arg: { job: Job }) => void)[] = [];
  let nextJobTimeout: NodeJS.Timeout | null = null;

  const consumeNextJob = async ({ job }: { job: Job }) => {
    const resolver = pendingResolvers.shift();

    if (!resolver) {
      return;
    }

    resolver({ job });
  };

  const refreshConsumption = ({ processingTimeoutMs, getNow = () => new Date() }: { processingTimeoutMs: number; getNow?: () => Date }) => {
    const now = getNow();
    const processingExpiresAt = new Date(now.getTime() - processingTimeoutMs);
    const nextJob = getNextJob({ jobsRegistry, processingExpiresAt });

    if (nextJobTimeout) {
      clearTimeout(nextJobTimeout);
    }

    if (!nextJob) {
      return;
    }

    const availableAt = nextJob.status === 'pending' ? nextJob.scheduleAt : processingExpiresAt;
    const deltaMs = availableAt.getTime() - now.getTime();

    if (deltaMs <= 0) {
      consumeNextJob({ job: nextJob });
      return;
    }

    nextJobTimeout = setTimeout(
      () => {
        refreshConsumption({ processingTimeoutMs, getNow });
      },
      deltaMs,
    );
  };

  return {
    fetchNextJob: async ({ processingTimeoutMs, getNow = () => new Date() }) => {
      const { promise, resolve } = Promise.withResolvers<{ job: Job }>();

      pendingResolvers.push(resolve);

      refreshConsumption({ processingTimeoutMs });

      const { job } = await promise;

      jobsRegistry.set(job.id, {
        ...job,
        status: 'processing',
        startedAt: getNow(),
      });

      return { job };
    },
    saveJob: async ({ job, getNow = () => new Date() }) => {
      if (jobsRegistry.has(job.id)) {
        throw createJobWithSameIdExistsError();
      }

      jobsRegistry.set(job.id, job);
      refreshConsumption({ processingTimeoutMs: 15000, getNow });
    },
    markJobAsCompleted: async ({ jobId, getNow = () => new Date(), result }) => {
      const job = jobsRegistry.get(jobId);

      if (!job) {
        throw createJobNotFoundError();
      }

      jobsRegistry.set(jobId, {
        ...job,
        status: 'completed',
        completedAt: getNow(),
        result,
      });
    },
    markJobAsFailed: async ({ jobId, error }) => {
      const job = jobsRegistry.get(jobId);

      if (!job) {
        throw createJobNotFoundError();
      }

      jobsRegistry.set(jobId, {
        ...job,
        status: 'failed',
        error,
      });
    },
    getJob: async ({ jobId }) => {
      const job = jobsRegistry.get(jobId) ?? null;

      return {
        job: job
          ? {
              result: undefined,
              error: undefined,
              startedAt: undefined,
              completedAt: undefined,
              ...job,
            }
          : null,
      };
    },
  };
}
