import type { Driver, ClaimedJob } from '../driver/driver';
import type { HandlerDefinition } from '../handlers/handler-definition';
import { createError } from '../../errors/errors.models';
import { getHandlerInternals } from '../handlers/handler-definition';
import { PermanentTaskError } from '../handlers/permanent-task-error';
import { serializeJobError } from '../jobs/serialize-job-error';
import { retryDelay } from '../shared/retry';
import { validatePayload } from '../tasks/validate-payload';

export type ClaimedJobHandlerOutcome =
  | { status: 'succeeded' }
  | { status: 'failed'; error: unknown; permanent: boolean };

export async function runWorkerOperation({
  driver,
  handlers,
  concurrency,
  leaseDurationMs,
  signal,
}: {
  driver: Driver;
  handlers: ReadonlyMap<string, HandlerDefinition>;
  concurrency: number;
  leaseDurationMs: number;
  signal?: AbortSignal;
}): Promise<number> {
  signal?.throwIfAborted();

  const jobs = await driver.claimJobs({
    taskNames: [...handlers.keys()],
    limit: concurrency,
    leaseDurationMs,
  });

  const executions = await Promise.allSettled(
    jobs.map(async (job) => {
      const handler = handlers.get(job.taskName);
      if (handler === undefined) {
        throw createError({
          code: 'worker.handler-not-found',
          message: `No handler is registered for task ${job.taskName}`,
        });
      }

      await executeClaimedJob({ driver, handler, job, signal });
    }),
  );

  const failedExecution = executions.find(
    (execution): execution is PromiseRejectedResult => execution.status === 'rejected',
  );
  if (failedExecution !== undefined) {
    throw failedExecution.reason;
  }

  return jobs.length;
}

async function executeClaimedJob({
  driver,
  handler,
  job,
  signal,
}: {
  driver: Driver;
  handler: HandlerDefinition;
  job: ClaimedJob;
  signal?: AbortSignal;
}): Promise<void> {
  const controller = new AbortController();
  const abort = () => controller.abort(signal?.reason);

  if (signal?.aborted === true) {
    abort();
  } else {
    signal?.addEventListener('abort', abort, { once: true });
  }

  try {
    const outcome = await executeClaimedJobHandler({
      handler,
      job,
      signal: controller.signal,
    });
    const transitioned = await transitionClaimedJob({ driver, job, outcome });
    if (!transitioned) {
      throw createStaleLeaseError(job.id);
    }
  } finally {
    signal?.removeEventListener('abort', abort);
  }
}

export async function executeClaimedJobHandler({
  handler,
  job,
  signal,
}: {
  handler: HandlerDefinition;
  job: ClaimedJob;
  signal: AbortSignal;
}): Promise<ClaimedJobHandlerOutcome> {
  const { schema, run } = getHandlerInternals(handler);
  let payload;

  try {
    payload = validatePayload(schema, job.payload);
  } catch (error) {
    return { status: 'failed', error, permanent: true };
  }

  try {
    await run(payload, {
      jobId: job.id,
      taskName: job.taskName,
      attempt: job.attempts,
      availableAt: job.availableAt,
      signal,
      ...(job.schedule === undefined ? {} : { schedule: job.schedule }),
    });
    return { status: 'succeeded' };
  } catch (error) {
    return { status: 'failed', error, permanent: isPermanentTaskError(error) };
  }
}

export async function transitionClaimedJob({
  driver,
  job,
  outcome,
}: {
  driver: Driver;
  job: ClaimedJob;
  outcome: ClaimedJobHandlerOutcome;
}): Promise<boolean> {
  const lease = { id: job.id, token: job.leaseToken };

  if (outcome.status === 'succeeded') {
    return driver.completeJob(lease);
  }

  const error = serializeJobError(outcome.error);
  if (outcome.permanent || job.attempts >= job.retry.maxAttempts) {
    return driver.failJob({ lease, error });
  }

  return driver.retryJob({
    lease,
    error,
    delayMs: retryDelay(job.retry, job.attempts),
  });
}

export async function runClaimedJobHandler({
  handler,
  job,
  signal,
}: {
  handler: HandlerDefinition;
  job: ClaimedJob;
  signal: AbortSignal;
}): Promise<void> {
  const outcome = await executeClaimedJobHandler({ handler, job, signal });
  if (outcome.status === 'failed') {
    throw outcome.error;
  }
}

function isPermanentTaskError(error: unknown): boolean {
  try {
    return error instanceof PermanentTaskError;
  } catch {
    return false;
  }
}

function createStaleLeaseError(jobId: string) {
  return createError({
    code: 'job.stale-lease',
    message: `The lease for job ${jobId} is no longer current`,
  });
}
