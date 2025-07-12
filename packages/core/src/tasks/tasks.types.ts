import type { StandardSchemaV1 } from '@standard-schema/spec';
import type { JobResult } from '../jobs/jobs.types';

export type TaskOptions = {
  maxRetries?: number;
  retryBackoff?: 'linear' | 'exponential' | ((args: { attempt: number }) => number);
};

export type TaskDefinition<ArgsSchema extends StandardSchemaV1 = StandardSchemaV1, TResult = JobResult> = {
  taskName: string;
  options?: TaskOptions;
  schema?: {
    data?: ArgsSchema;
  };
  handler: (args: { data: StandardSchemaV1.InferOutput<ArgsSchema>; context: TaskContext }) => Promise<TResult | undefined | void>;
};

export type TaskContext = {
  workerId: string;
};
