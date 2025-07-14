import type { EventEmitter } from '../events/event-emitter';

export type WorkerEvents = {
  'job.started': { jobId: string };
  'job.completed': { jobId: string; result: unknown };
  'job.failed': { jobId: string; error: Error | undefined };
  'job.rescheduled': { jobId: string; nextDate: Date; error: Error | undefined };
  'task.not-found': { taskName: string };
};

export type WorkerEventEmitter = EventEmitter<WorkerEvents>;
