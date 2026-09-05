import type { JsonValue } from '../shared/json';
import type { RetryPolicy } from '../shared/retry';
import type { TaskDefinition } from '../tasks/task-definition';
import { createError } from '../../errors/errors.models';

const scheduleIdPattern = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

export type CronTrigger = {
  cron: string;
  timeZone?: string;
};

export type Schedule<Payload extends JsonValue = JsonValue> = {
  id: string;
  taskName: string;
  payload: Payload;
  retry: RetryPolicy;
  trigger: Required<CronTrigger>;
  createdAt: Temporal.Instant;
  updatedAt: Temporal.Instant;
  nextRunAt: Temporal.Instant;
  lastMaterializedAt?: Temporal.Instant;
};

export type UpsertScheduleOptions<Name extends string, Input, Payload extends JsonValue> = {
  id: string;
  task: TaskDefinition<Name, Input, Payload>;
  payload: NoInfer<Input>;
  trigger: CronTrigger;
};

export type ScheduleClient = {
  upsert<Name extends string, Input, Payload extends JsonValue>(
    options: UpsertScheduleOptions<Name, Input, Payload>,
  ): Promise<Schedule<Payload>>;
  get(id: string): Promise<Schedule | undefined>;
  delete(id: string): Promise<boolean>;
};

export function assertScheduleId(id: string): void {
  if (id.length < 1 || id.length > 128 || !scheduleIdPattern.test(id)) {
    throw createError({
      code: 'schedule.invalid-id',
      message: 'Schedule IDs must be 1-128 characters and match /^[A-Za-z0-9][A-Za-z0-9._-]*$/',
    });
  }
}
