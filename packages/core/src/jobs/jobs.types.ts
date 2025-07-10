type JsonSerializable = string | number | boolean | null | undefined | JsonSerializable[] | { [key: string]: JsonSerializable };

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
  scheduleAt: Date;
};

export type JobRepositoryDriver = {
  saveJob: (arg: { job: Job; getNow?: () => Date }) => Promise<void>;
  fetchNextJob: (arg: { processingTimeoutMs: number; getNow?: () => Date; abortSignal?: AbortSignal }) => Promise<{ job: Job }>;
  markJobAsCompleted: (arg: { jobId: string; getNow?: () => Date; result?: JobResult }) => Promise<void>;
  markJobAsFailed: (arg: { jobId: string; getNow?: () => Date; error: string }) => Promise<void>;
  getJob: (arg: { jobId: string }) => Promise<{ job: Job | null }>;
};
