import type { Driver, ClaimedJob } from '../driver/driver';
import type { HandlerDefinition } from '../handlers/handler-definition';
import { createError } from '../../errors/errors.models';
import { getHandlerInternals } from '../handlers/handler-definition';
import { validatePayload } from '../tasks/validate-payload';

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
    await runClaimedJobHandler({ handler, job, signal: controller.signal });

    const completed = await driver.completeJob({ id: job.id, token: job.leaseToken });
    if (!completed) {
      throw createError({
        code: 'job.stale-lease',
        message: `The lease for job ${job.id} is no longer current`,
      });
    }
  } finally {
    signal?.removeEventListener('abort', abort);
  }
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
  const { schema, run } = getHandlerInternals(handler);
  const payload = validatePayload(schema, job.payload);

  await run(payload, {
    jobId: job.id,
    taskName: job.taskName,
    attempt: job.attempts,
    availableAt: job.availableAt,
    signal,
    ...(job.schedule === undefined ? {} : { schedule: job.schedule }),
  });
}
