import type { Job, JobRepositoryDriver } from '@cadence-mq/core';
import { createJobNotFoundError, createJobWithSameIdExistsError } from './errors';

function getNextJob({ jobsRegistry, processingExpiresAt }: { jobsRegistry: Map<string, Job>; processingExpiresAt: Date }) {
  let nextJob: Job | null = null;

  const isJobSelectable = (job: Job) => job.status === 'pending' || (job.status === 'processing');
  const isJobScheduledEarlier = (job: Job) =>
    nextJob === null
    || (job.status === 'pending' && job.scheduledAt < nextJob.scheduledAt)
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

    const availableAt = nextJob.status === 'pending' ? nextJob.scheduledAt : processingExpiresAt;
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
    getNextJobAndMarkAsProcessing: async ({ now = new Date() }) => {
      const { promise, resolve } = Promise.withResolvers<{ job: Job }>();

      pendingResolvers.push(resolve);

      refreshConsumption({ processingTimeoutMs: 15_000 }); // TODO: make this configurable

      const { job } = await promise;

      jobsRegistry.set(job.id, {
        ...job,
        status: 'processing',
        startedAt: now,
      });

      return { job };
    },
    saveJob: async ({ job }) => {
      if (jobsRegistry.has(job.id)) {
        throw createJobWithSameIdExistsError();
      }

      jobsRegistry.set(job.id, job);
      refreshConsumption({ processingTimeoutMs: 15000 });
    },
    markJobAsCompleted: async ({ jobId, now = new Date(), result }) => {
      const job = jobsRegistry.get(jobId);

      if (!job) {
        throw createJobNotFoundError();
      }

      jobsRegistry.set(jobId, {
        ...job,
        status: 'completed',
        completedAt: now,
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
              cron: undefined,
              ...job,
            }
          : null,
      };
    },
    getJobCount: async ({ filter } = {}) => {
      if (!filter) {
        return { count: jobsRegistry.size };
      }

      const filterEntries = Object.entries(filter);

      const filteredJobs = Array.from(jobsRegistry.values()).filter(job => filterEntries.every(([key, value]) => job[key as keyof Job] === value));

      return { count: filteredJobs.length };
    },
    updateJob: async ({ jobId, values }) => {
      const existingJob = jobsRegistry.get(jobId);

      if (!existingJob) {
        throw createJobNotFoundError();
      }

      jobsRegistry.set(jobId, { ...existingJob, ...values });
    },
  };
}
