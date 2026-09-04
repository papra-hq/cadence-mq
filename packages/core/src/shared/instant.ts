import { createError } from '../../errors/errors.models';

export function normalizeInstant(instant: Temporal.InstantLike): Temporal.Instant {
  try {
    const parsed = Temporal.Instant.from(instant);
    return Temporal.Instant.fromEpochMilliseconds(parsed.epochMilliseconds);
  } catch (cause) {
    throw createError({
      code: 'instant.invalid',
      message: 'Invalid instant',
      cause,
    });
  }
}

export function compareInstants(left: Temporal.Instant, right: Temporal.Instant): number {
  return Temporal.Instant.compare(left, right);
}
