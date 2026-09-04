export type Clock = {
  now: () => Temporal.Instant;
};

/** A duration-based timer that resolves early when its signal is aborted. */
export type Scheduler = {
  sleep: (durationMs: number, signal?: AbortSignal) => Promise<void>;
};
