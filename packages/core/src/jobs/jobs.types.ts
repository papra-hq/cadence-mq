import type { Expand } from '@corentinth/chisels';

export type JsonSerializable = string | number | boolean | null | undefined | JsonSerializable[] | { [key: string]: JsonSerializable };

export type JobData = JsonSerializable;
export type JobResult = JsonSerializable;
export type JobStatus = 'pending' | 'processing' | 'completed' | 'failed';

export type Job = {
  id: string;
  taskName: string;
  status: JobStatus;
  error?: string;
  startedAt?: Date;
  completedAt?: Date;
  maxRetries?: number;
  data?: JobData;
  result?: JobResult;
  scheduledAt: Date;
  cron?: string;
  createdAt: Date;
};

export type JobUpdate = Expand<Partial<Pick<Job, 'status' | 'error' | 'result' | 'startedAt' | 'completedAt' | 'maxRetries' | 'data' | 'cron' | 'scheduledAt'>>>;

export type JobRepositoryDriver = {
  saveJob: (arg: { job: Job; now?: Date }) => Promise<void>;
  updateJob: (arg: { jobId: string; values: JobUpdate; now?: Date }) => Promise<void>;
  getNextJobAndMarkAsProcessing: (arg: { abortSignal: AbortSignal; now?: Date }) => Promise<{ job: Job }>;
  getJob: (arg: { jobId: string }) => Promise<{ job: Job | null }>;
  getJobCount: (arg?: { filter?: { status?: JobStatus } }) => Promise<{ count: number }>;
};
