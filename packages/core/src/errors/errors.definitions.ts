import { createErrorFactory } from './errors.models';

export const createJobWithSameIdExistsError = createErrorFactory({
  code: 'jobs.unique-id-constraint-violation',
  message: 'A job with the same id already exists',
});

export const createJobNotFoundError = createErrorFactory({
  code: 'jobs.not-found',
  message: 'Job not found',
});
