import type { Driver, Job, NewJob } from '../index';
import type { StandardSchemaV1 } from '@standard-schema/spec';
import { describe, expect, test } from 'vitest';
import * as v from 'valibot';
import { createCadence, defineTask, isCadenceError } from '../index';

function createRecordingDriver(): {
  driver: Driver;
  initialized: () => number;
  inserted: () => number;
  lastInserted: () => NewJob | undefined;
} {
  let initializationCount = 0;
  const jobs: NewJob[] = [];

  return {
    initialized: () => initializationCount,
    inserted: () => jobs.length,
    lastInserted: () => jobs.at(-1),
    driver: {
      name: 'recording',
      initialize: async () => {
        initializationCount += 1;
      },
      close: async () => {},
      now: async () => Temporal.Instant.from('2026-01-01T00:00:00Z'),
      insertJob: async (job): Promise<Job> => {
        jobs.push(job);
        return {
          ...job,
          status: 'pending',
          attempts: 0,
          createdAt: Temporal.Instant.from('2026-01-01T00:00:00Z'),
        };
      },
      getJob: async () => undefined,
      claimJobs: async () => [],
      renewJobLeases: async () => [],
      completeJob: async () => false,
      retryJob: async () => false,
      failJob: async () => false,
    },
  };
}

describe('defineTask', () => {
  test('the default retry policy allows one execution', () => {
    const task = defineTask({ name: 'email.send', schema: v.string() });

    expect(task.retry).toEqual({ maxAttempts: 1 });
  });

  test.each(['', '.email', 'email send', 'a'.repeat(129)])(
    'the task name %j is rejected',
    (name) => {
      expect(() => defineTask({ name, schema: v.string() })).toThrowError(
        expect.objectContaining({ code: 'task.invalid-name' }),
      );
    },
  );

  test.each([
    { maxAttempts: 0 },
    { maxAttempts: 1.5 },
    { maxAttempts: 2, backoff: { type: 'fixed', delayMs: -1 } as const },
    {
      maxAttempts: 2,
      backoff: {
        type: 'exponential',
        initialDelayMs: 1,
        maxDelayMs: Number.POSITIVE_INFINITY,
      } as const,
    },
  ])('the retry policy %# is rejected', (retry) => {
    expect(() => defineTask({ name: 'email.send', schema: v.string(), retry })).toThrowError(
      expect.objectContaining({ code: 'task.invalid-retry-policy' }),
    );
  });
});

describe('enqueue payload validation', () => {
  test('the schema output is persisted instead of its input', async () => {
    const recording = createRecordingDriver();
    const cadence = createCadence({ driver: recording.driver });
    const task = defineTask({
      name: 'email.normalize',
      schema: v.pipe(
        v.string(),
        v.transform((recipient) => ({ recipient: recipient.trim().toLowerCase() })),
      ),
    });

    await cadence.enqueue(task, ' JANE@EXAMPLE.COM ');

    expect(recording.lastInserted()?.payload).toEqual({ recipient: 'jane@example.com' });
  });

  test('payload input mutation cannot race asynchronous persistence', async () => {
    type Payload = { nested: { value: string } };
    const schema: StandardSchemaV1<Payload, Payload> = {
      '~standard': {
        version: 1,
        vendor: 'test',
        validate: (value) => ({ value: value as Payload }),
      },
    };
    const recording = createRecordingDriver();
    const cadence = createCadence({ driver: recording.driver });
    const task = defineTask({ name: 'payload.copy', schema });
    const payload = { nested: { value: 'original' } };

    const enqueue = cadence.enqueue(task, payload);
    payload.nested.value = 'mutation';
    await enqueue;

    expect(recording.lastInserted()?.payload).toEqual({ nested: { value: 'original' } });
  });

  test('an invalid payload is rejected before driver initialization or persistence', async () => {
    const recording = createRecordingDriver();
    const cadence = createCadence({ driver: recording.driver });
    const task = defineTask({
      name: 'email.send',
      schema: v.object({ recipient: v.pipe(v.string(), v.email()) }),
    });

    await expect(cadence.enqueue(task, { recipient: 'not-an-email' })).rejects.toSatisfy(
      (error: unknown) => isCadenceError(error) && error.code === 'payload.invalid',
    );
    expect(recording.initialized()).toBe(0);
    expect(recording.inserted()).toBe(0);
  });

  test('asynchronous Standard Schema validation is rejected', async () => {
    const schema: StandardSchemaV1<string, string> = {
      '~standard': {
        version: 1,
        vendor: 'test',
        validate: async (value) => ({ value: String(value) }),
      },
    };
    const recording = createRecordingDriver();
    const cadence = createCadence({ driver: recording.driver });
    const task = defineTask({ name: 'async.schema', schema });

    await expect(cadence.enqueue(task, 'payload')).rejects.toSatisfy(
      (error: unknown) =>
        isCadenceError(error) && error.code === 'schema.async-validation-unsupported',
    );
    expect(recording.inserted()).toBe(0);
  });

  test('a non-JSON schema output is rejected', async () => {
    const schema: StandardSchemaV1<string, string> = {
      '~standard': {
        version: 1,
        vendor: 'test',
        validate: () => ({ value: new Date() as unknown as string }),
      },
    };
    const recording = createRecordingDriver();
    const cadence = createCadence({ driver: recording.driver });
    const task = defineTask({ name: 'invalid.output', schema });

    await expect(cadence.enqueue(task, 'payload')).rejects.toSatisfy(
      (error: unknown) => isCadenceError(error) && error.code === 'payload.not-json',
    );
    expect(recording.inserted()).toBe(0);
  });
});
