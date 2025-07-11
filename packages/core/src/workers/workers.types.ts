import type { EventEmitter } from '../events/event-emitter';

export type WorkerEvents = {
  'job.started': { jobId: string };
  'job.completed': { jobId: string; result: unknown };
  'job.failed': { jobId: string; error: unknown };
};

export type WorkerEventEmitter = EventEmitter<WorkerEvents>;
