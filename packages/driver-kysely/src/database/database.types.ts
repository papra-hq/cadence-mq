import type { JobStatus } from '@cadence-mq/core';
import type {
  Insertable,
  Kysely,
  Selectable,
  Updateable,
} from 'kysely';

export type JobTable = {
  id: string;
  task_name: string;
  data?: string;
  status: JobStatus;
  error?: string;
  result?: string;
  scheduled_at: string;
  started_at?: string;
  completed_at?: string;
  max_retries?: number;
  cron?: string;
  created_at: string;
  delete_job_on_completion?: number;
};

export type JobSelectable = Selectable<JobTable>;
export type JobInsertable = Insertable<JobTable>;
export type JobUpdateable = Updateable<JobTable>;

export type Database = {
  jobs: JobTable;
};

export type DatabaseClient = Kysely<Database>;
