import type { JobData, JobResult } from '../jobs/jobs.types';

export type TaskOptions = {
  maxRetries?: number;
  retryBackoff?: 'linear' | 'exponential' | ((args: { attempt: number }) => number);
};

export type TaskDefinition<TData = JobData, TResult = JobResult> = {
  name: string;
  options?: TaskOptions;
  handler: (args: { data: TData; context: TaskContext }) => Promise<TResult | undefined | void>;
};

export type TaskContext = {
  workerId: string;
};
