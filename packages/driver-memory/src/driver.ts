import type { Job, JobRepositoryDriver } from '@cadence-mq/core';
import { createJobNotFoundError } from '@cadence-mq/core';
import { createJobWithSameIdExistsError } from './errors';

function getNextJob({ jobsRegistry, processingTimeoutMs, now = new Date() }: { jobsRegistry: Map<string, Job>; processingTimeoutMs: number; now?: Date }) {
  let nextJob: Job | null = null;

  const isJobSelectable = (job: Job) => job.status === 'pending' || (job.status === 'processing' && job.startedAt && job.startedAt.getTime() + processingTimeoutMs < now.getTime());
  const isJobScheduledEarlier = (job: Job) => nextJob === null || (job.scheduledAt < nextJob.scheduledAt);

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
    const nextJob = getNextJob({ jobsRegistry, processingTimeoutMs, now });
    const nextJobProcessingExpiresAt = nextJob?.startedAt ? new Date(nextJob.startedAt.getTime() + processingTimeoutMs) : undefined;

    if (nextJobTimeout) {
      clearTimeout(nextJobTimeout);
    }

    if (!nextJob) {
      return;
    }

    const availableAt = nextJob.status === 'processing' ? nextJobProcessingExpiresAt! : nextJob.scheduledAt;
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

      refreshConsumption({ processingTimeoutMs: 10 * 60 * 1000 }); // TODO: make this configurable

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
      refreshConsumption({ processingTimeoutMs: 10 * 60 * 1000 });
    },
    getJob: async ({ jobId }) => {
      const job = jobsRegistry.get(jobId);

      if (!job) {
        return { job: null };
      }

      return {
        job: {
          result: undefined,
          error: undefined,
          startedAt: undefined,
          completedAt: undefined,
          cron: undefined,
          ...job,
        },
      };
    },
    getJobCount: async ({ filter } = {}) => {
      if (!filter) {
        return { count: jobsRegistry.size };
      }

      const filterEntries = Object.entries(filter);
      const isJobMatchingFilter = (job: Job) => filterEntries.every(([key, value]) => job[key as keyof Job] === value);

      const filteredJobs = Array.from(jobsRegistry.values()).filter(isJobMatchingFilter);

      return { count: filteredJobs.length };
    },
    updateJob: async ({ jobId, values }) => {
      const existingJob = jobsRegistry.get(jobId);

      if (!existingJob) {
        throw createJobNotFoundError();
      }

      jobsRegistry.set(jobId, { ...existingJob, ...values });
    },
    deleteJob: async ({ jobId }) => {
      const existingJob = jobsRegistry.get(jobId);

      if (!existingJob) {
        throw createJobNotFoundError();
      }

      jobsRegistry.delete(jobId);
    },
  };
}
