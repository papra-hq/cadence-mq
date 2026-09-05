import type { Scheduler } from '../clock/clock.types';
import type { ClaimedJob, Driver } from '../driver/driver';
import type { HandlerDefinition } from '../handlers/handler-definition';
import type { SerializedJobError } from '../jobs/job';
import type { CadenceError } from '../../errors/errors.models';
import { createError, isCadenceError } from '../../errors/errors.models';
import { systemClock } from '../clock/system-clock';
import { getHandlerInternals } from '../handlers/handler-definition';
import { materializeSchedule } from '../schedules/materialize-schedule';
import { executeClaimedJobHandler, transitionClaimedJob } from './worker-operation';

export type WorkerOptions = {
  handlers: ReadonlyArray<HandlerDefinition>;
  concurrency?: number;
  pollingIntervalMs?: number;
  leaseDurationMs?: number;
  heartbeatIntervalMs?: number;
  /** Overrides worker timing for deterministic tests. */
  scheduler?: Scheduler;
  onError?: (error: CadenceError) => void;
};

export type WorkerState = 'idle' | 'running' | 'stopping' | 'stopped';

export type StopWorkerOptions = {
  gracePeriodMs?: number;
};

export type Worker = {
  readonly state: WorkerState;
  start(): Promise<void>;
  stop(options?: StopWorkerOptions): Promise<void>;
};

type ActiveExecution = {
  key: string;
  job: ClaimedJob;
  controller: AbortController;
  leaseState: 'current' | 'stale' | 'releasing';
  leaseDeadline: LeaseDeadline | undefined;
  completion: Promise<void>;
};

type LeaseDeadline = {
  controller: AbortController;
  executions: Set<ActiveExecution>;
  expired: boolean;
};

const shutdownJobError: SerializedJobError = {
  name: 'AbortError',
  message: 'Job execution was aborted because the worker stopped',
  code: 'job.worker-shutdown',
};

export function createWorker({
  driver,
  ensureInitialized,
  options,
}: {
  driver: Driver;
  ensureInitialized: () => Promise<void>;
  options: WorkerOptions;
}): Worker {
  const concurrency = options.concurrency ?? 1;
  const pollingIntervalMs = options.pollingIntervalMs ?? 1_000;
  const leaseDurationMs = options.leaseDurationMs ?? 30_000;
  const heartbeatIntervalMs = options.heartbeatIntervalMs ?? 10_000;
  const scheduler = options.scheduler ?? systemClock;
  const handlers = createHandlerMap(options.handlers);

  assertPositiveInteger(concurrency, 'concurrency');
  assertPositiveInteger(pollingIntervalMs, 'pollingIntervalMs');
  assertPositiveInteger(leaseDurationMs, 'leaseDurationMs');
  assertPositiveInteger(heartbeatIntervalMs, 'heartbeatIntervalMs');
  if (heartbeatIntervalMs >= leaseDurationMs) {
    throw createError({
      code: 'worker.invalid-options',
      message: 'heartbeatIntervalMs must be less than leaseDurationMs',
    });
  }

  let state: WorkerState = 'idle';
  let startPromise: Promise<void> | undefined;
  let stopPromise: Promise<void> | undefined;
  let pollingLoop: Promise<void> | undefined;
  let schedulePollingLoop: Promise<void> | undefined;
  let heartbeatLoop: Promise<void> | undefined;
  const pollingController = new AbortController();
  const heartbeatController = new AbortController();
  const activeExecutions = new Map<string, ActiveExecution>();
  const activeScheduleMaterializations = new Set<Promise<void>>();
  const leaseDeadlines = new Set<LeaseDeadline>();

  const releaseClaim = async (job: ClaimedJob): Promise<void> => {
    try {
      if (job.attempts >= job.retry.maxAttempts) {
        await driver.failJob({
          lease: { id: job.id, token: job.leaseToken },
          error: shutdownJobError,
        });
      } else {
        await driver.retryJob({
          lease: { id: job.id, token: job.leaseToken },
          error: shutdownJobError,
          delayMs: 0,
        });
      }
    } catch (error) {
      reportError(error, options.onError);
    }
  };

  const cancelLeaseDeadline = (deadline: LeaseDeadline): void => {
    deadline.controller.abort();
    leaseDeadlines.delete(deadline);
  };

  const detachLeaseDeadline = (execution: ActiveExecution): void => {
    const deadline = execution.leaseDeadline;
    if (deadline === undefined) {
      return;
    }

    execution.leaseDeadline = undefined;
    deadline.executions.delete(execution);
    if (deadline.executions.size === 0 && !deadline.expired) {
      cancelLeaseDeadline(deadline);
    }
  };

  const markLeaseStale = (execution: ActiveExecution): void => {
    if (execution.leaseState !== 'current') {
      return;
    }

    execution.leaseState = 'stale';
    detachLeaseDeadline(execution);
    execution.controller.abort(
      createError({
        code: 'job.stale-lease',
        message: `The lease for job ${execution.job.id} is no longer current`,
      }),
    );
  };

  const expireLeaseDeadline = (deadline: LeaseDeadline): void => {
    if (deadline.expired || deadline.controller.signal.aborted) {
      return;
    }

    deadline.expired = true;
    leaseDeadlines.delete(deadline);
    for (const execution of [...deadline.executions]) {
      if (execution.leaseDeadline === deadline) {
        markLeaseStale(execution);
      }
    }
  };

  const createLeaseDeadline = (): LeaseDeadline => {
    const deadline: LeaseDeadline = {
      controller: new AbortController(),
      executions: new Set(),
      expired: false,
    };
    leaseDeadlines.add(deadline);

    // Start before driver I/O so request latency cannot extend the locally trusted lease.
    try {
      void scheduler.sleep(leaseDurationMs, deadline.controller.signal).then(
        () => expireLeaseDeadline(deadline),
        (error: unknown) => {
          if (!deadline.controller.signal.aborted) {
            reportError(error, options.onError);
            expireLeaseDeadline(deadline);
          }
        },
      );
    } catch (error) {
      reportError(error, options.onError);
      expireLeaseDeadline(deadline);
    }

    return deadline;
  };

  const attachLeaseDeadline = (execution: ActiveExecution, deadline: LeaseDeadline): void => {
    detachLeaseDeadline(execution);
    execution.leaseDeadline = deadline;
    deadline.executions.add(execution);

    if (deadline.expired || deadline.controller.signal.aborted) {
      markLeaseStale(execution);
    }
  };

  const cancelUnusedLeaseDeadline = (deadline: LeaseDeadline): void => {
    if (deadline.executions.size === 0) {
      cancelLeaseDeadline(deadline);
    }
  };

  const execute = async (execution: ActiveExecution, handler: HandlerDefinition): Promise<void> => {
    try {
      const outcome = await executeClaimedJobHandler({
        handler,
        job: execution.job,
        signal: execution.controller.signal,
      });

      if (execution.leaseState !== 'current') {
        return;
      }

      try {
        const transitioned = await transitionClaimedJob({
          driver,
          job: execution.job,
          outcome,
        });
        if (!transitioned) {
          markLeaseStale(execution);
        }
      } catch (error) {
        reportError(error, options.onError);
      }
    } catch (error) {
      reportError(error, options.onError);
    } finally {
      detachLeaseDeadline(execution);
      if (activeExecutions.get(execution.key) === execution) {
        activeExecutions.delete(execution.key);
      }
    }
  };

  const startExecution = (job: ClaimedJob, leaseDeadline: LeaseDeadline): void => {
    const handler = handlers.get(job.taskName);
    if (handler === undefined) {
      reportError(
        createError({
          code: 'worker.handler-not-found',
          message: `No handler is registered for task ${job.taskName}`,
        }),
        options.onError,
      );
      return;
    }

    const execution: ActiveExecution = {
      key: `${job.id}:${job.leaseToken}`,
      job,
      controller: new AbortController(),
      leaseState: 'current',
      leaseDeadline: undefined,
      completion: Promise.resolve(),
    };
    activeExecutions.set(execution.key, execution);
    attachLeaseDeadline(execution, leaseDeadline);
    execution.completion = execute(execution, handler);
  };

  const poll = async (): Promise<void> => {
    const { signal } = pollingController;

    while (!signal.aborted) {
      const availableSlots = concurrency - activeExecutions.size;
      if (availableSlots > 0) {
        const leaseDeadline = createLeaseDeadline();
        try {
          const jobs = await driver.claimJobs({
            taskNames: [...handlers.keys()],
            limit: availableSlots,
            leaseDurationMs,
          });

          if (signal.aborted || leaseDeadline.expired) {
            await Promise.all(jobs.map(releaseClaim));
            if (signal.aborted) {
              break;
            }
          } else {
            for (const job of jobs) {
              if (signal.aborted) {
                await releaseClaim(job);
              } else {
                startExecution(job, leaseDeadline);
              }
            }
          }
        } catch (error) {
          if (!signal.aborted) {
            reportError(error, options.onError);
          }
        } finally {
          cancelUnusedLeaseDeadline(leaseDeadline);
        }
      }

      try {
        await scheduler.sleep(pollingIntervalMs, signal);
      } catch (error) {
        if (!signal.aborted) {
          reportError(error, options.onError);
        }
      }
    }
  };

  const pollSchedules = async (): Promise<void> => {
    const { signal } = pollingController;

    while (!signal.aborted) {
      try {
        const schedules = await driver.claimDueSchedules({
          limit: Math.max(1, concurrency),
          leaseDurationMs,
        });
        if (signal.aborted) {
          await Promise.all(
            schedules.map(async ({ id, leaseToken }) => {
              await driver.releaseScheduleClaim({ id, token: leaseToken });
            }),
          );
          break;
        }

        await Promise.all(
          schedules.map(async (schedule) => {
            const operation = (async (): Promise<void> => {
              try {
                await materializeSchedule(driver, schedule);
              } catch (error) {
                if (!signal.aborted) {
                  reportError(error, options.onError);
                }
              }
            })();
            activeScheduleMaterializations.add(operation);
            operation.then(
              () => activeScheduleMaterializations.delete(operation),
              () => activeScheduleMaterializations.delete(operation),
            );
            return operation;
          }),
        );
      } catch (error) {
        if (!signal.aborted) {
          reportError(error, options.onError);
        }
      }

      try {
        await scheduler.sleep(pollingIntervalMs, signal);
      } catch (error) {
        if (!signal.aborted) {
          reportError(error, options.onError);
        }
      }
    }
  };

  const heartbeat = async (): Promise<void> => {
    const { signal } = heartbeatController;

    while (!signal.aborted) {
      try {
        await scheduler.sleep(heartbeatIntervalMs, signal);
      } catch (error) {
        if (!signal.aborted) {
          reportError(error, options.onError);
        }
      }
      if (signal.aborted) {
        break;
      }

      const executions = [...activeExecutions.values()].filter(
        ({ leaseState }) => leaseState === 'current',
      );
      if (executions.length === 0) {
        continue;
      }

      const leaseDeadline = createLeaseDeadline();
      try {
        const renewedIds = new Set(
          await driver.renewJobLeases({
            leases: executions.map(({ job }) => ({ id: job.id, token: job.leaseToken })),
            leaseDurationMs,
          }),
        );

        for (const execution of executions) {
          if (
            activeExecutions.get(execution.key) !== execution ||
            execution.leaseState !== 'current'
          ) {
            continue;
          }

          if (renewedIds.has(execution.job.id)) {
            attachLeaseDeadline(execution, leaseDeadline);
          } else {
            markLeaseStale(execution);
          }
        }
      } catch (error) {
        if (!signal.aborted) {
          reportError(error, options.onError);
        }
        // Keep each execution on its last confirmed deadline after an ambiguous failure.
      } finally {
        cancelUnusedLeaseDeadline(leaseDeadline);
      }
    }
  };

  const start = async (): Promise<void> => {
    if (state === 'running') {
      return startPromise ?? Promise.resolve();
    }
    if (state === 'stopping' || state === 'stopped') {
      return Promise.reject(
        createError({
          code: 'worker.cannot-restart',
          message: 'A stopped worker cannot be restarted',
        }),
      );
    }

    state = 'running';
    startPromise = (async () => {
      try {
        await ensureInitialized();
      } catch (error) {
        if (state === 'running') {
          state = 'idle';
          startPromise = undefined;
        }
        throw error;
      }

      if (state !== 'running') {
        return;
      }

      pollingLoop = poll();
      schedulePollingLoop = pollSchedules();
      heartbeatLoop = heartbeat();
    })();
    return startPromise;
  };

  const stop = async (stopOptions: StopWorkerOptions = {}): Promise<void> => {
    if (state === 'stopped') {
      return stopPromise ?? Promise.resolve();
    }
    if (state === 'stopping') {
      return stopPromise ?? Promise.resolve();
    }
    if (state === 'idle') {
      state = 'stopped';
      stopPromise = Promise.resolve();
      return stopPromise;
    }

    const gracePeriodMs = stopOptions.gracePeriodMs ?? 30_000;
    assertNonNegativeInteger(gracePeriodMs, 'gracePeriodMs');

    state = 'stopping';
    pollingController.abort();

    const executionsAtShutdown = [...activeExecutions.values()];
    const graceController = new AbortController();
    let expiryWork: Promise<void> = Promise.resolve();

    const expireGracePeriod = async (): Promise<void> => {
      const remainingExecutions = [...activeExecutions.values()];
      for (const execution of remainingExecutions) {
        if (execution.leaseState === 'current') {
          execution.leaseState = 'releasing';
          detachLeaseDeadline(execution);
        }
        execution.controller.abort(
          createError({
            code: 'worker.shutdown-aborted',
            message: `Job ${execution.job.id} exceeded the worker shutdown grace period`,
          }),
        );
      }

      heartbeatController.abort();
      await Promise.all(
        remainingExecutions
          .filter(({ leaseState }) => leaseState === 'releasing')
          .map(async ({ job }) => releaseClaim(job)),
      );
    };

    const graceDeadline = scheduler.sleep(gracePeriodMs, graceController.signal).then(
      (): 'cancelled' | 'expired' => {
        if (graceController.signal.aborted) {
          return 'cancelled';
        }

        expiryWork = expireGracePeriod();
        return 'expired';
      },
      (error: unknown): 'expired' => {
        reportError(error, options.onError);
        expiryWork = expireGracePeriod();
        return 'expired';
      },
    );

    stopPromise = (async () => {
      try {
        const handlerOutcome = await Promise.race([
          Promise.all(executionsAtShutdown.map(async ({ completion }) => completion)).then(
            () => 'completed' as const,
          ),
          graceDeadline,
        ]);

        if (handlerOutcome === 'expired') {
          await expiryWork;
        } else {
          heartbeatController.abort();
        }

        // Schedule commits cannot be cancelled once handed to a driver. Keep the worker and
        // client alive until every commit that began before polling was aborted has settled.
        await Promise.allSettled([...activeScheduleMaterializations]);

        if (handlerOutcome === 'completed') {
          const infrastructure = Promise.allSettled(
            [startPromise, pollingLoop, schedulePollingLoop, heartbeatLoop].filter(
              (operation): operation is Promise<void> => operation !== undefined,
            ),
          ).then(() => 'settled' as const);
          const infrastructureOutcome = await Promise.race([infrastructure, graceDeadline]);

          if (infrastructureOutcome === 'expired') {
            await expiryWork;
          } else {
            graceController.abort();
          }
        }
      } finally {
        graceController.abort();
        heartbeatController.abort();
        for (const execution of activeExecutions.values()) {
          detachLeaseDeadline(execution);
          execution.controller.abort();
        }
        for (const deadline of [...leaseDeadlines]) {
          cancelLeaseDeadline(deadline);
        }
        activeExecutions.clear();
        state = 'stopped';
      }
    })();

    return stopPromise;
  };

  return {
    get state() {
      return state;
    },
    start,
    stop,
  };
}

function createHandlerMap(
  definitions: ReadonlyArray<HandlerDefinition>,
): ReadonlyMap<string, HandlerDefinition> {
  const handlers = new Map<string, HandlerDefinition>();

  for (const handler of definitions) {
    if (handler === null || typeof handler !== 'object') {
      throw createInvalidHandlerError();
    }

    try {
      getHandlerInternals(handler);
    } catch (cause) {
      throw createInvalidHandlerError(cause);
    }

    if (handlers.has(handler.taskName)) {
      throw createError({
        code: 'worker.duplicate-handler',
        message: `A handler for task ${handler.taskName} is already registered`,
      });
    }
    handlers.set(handler.taskName, handler);
  }

  return handlers;
}

function reportError(error: unknown, onError?: (error: CadenceError) => void): void {
  const cadenceError = isCadenceError(error)
    ? error
    : createError({
        code: 'worker.operation-failed',
        message: 'Worker operation failed',
        cause: error,
      });

  try {
    onError?.(cadenceError);
  } catch {
    // Error reporters must not terminate worker infrastructure.
  }
}

function assertPositiveInteger(value: number, field: string): void {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw createError({
      code: 'worker.invalid-options',
      message: `${field} must be a positive integer`,
    });
  }
}

function assertNonNegativeInteger(value: number, field: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw createError({
      code: 'worker.invalid-options',
      message: `${field} must be a non-negative integer`,
    });
  }
}

function createInvalidHandlerError(cause?: unknown): CadenceError {
  return createError({
    code: 'worker.invalid-handler',
    message: 'Handlers must be created with defineHandler',
    cause,
  });
}
