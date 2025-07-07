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
  saveJob: (arg: { job: Job; now?: Date }) => Promise<void>;
  fetchNextJob: (arg: { processingTimeoutMs: number }) => Promise<{ job: Job }>;
  markJobAsCompleted: (arg: { jobId: string; now?: Date; result?: JobResult }) => Promise<void>;
  markJobAsFailed: (arg: { jobId: string; now?: Date; error: string }) => Promise<void>;

};
