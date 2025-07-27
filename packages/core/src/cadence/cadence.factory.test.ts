import type { JobRepositoryDriver } from '../jobs/jobs.types';
import { describe, expect, test } from 'vitest';
import { createTaskRegistry } from '../tasks/task-definition.registry';
import { createCadence } from './cadence.factory';

describe('cadence factory', () => {
  describe('createCadence', () => {
    test('an convenience helper for creating a scheduler a worker with a task registry and a driver', () => {
      const driver = {} as JobRepositoryDriver;
      const cadence = createCadence({ driver });

      const methods = Object.keys(cadence);

      expect(methods).to.eql([
        'createWorker',
        'scheduleJob',
        'schedulePeriodicJob',
        'registerTask',
        'getJob',
        'getJobCount',
        'deleteJob',
        'getTaskRegistry',
        'getDriver',
      ]);
    });

    test('a custom task registry can be provided', () => {
      const driver = {} as JobRepositoryDriver;
      const taskRegistry = createTaskRegistry();
      const cadence = createCadence({ driver, taskRegistry });

      expect(cadence.getTaskRegistry()).toBe(taskRegistry);
    });

    test('the provided driver can be retrieved', () => {
      const driver = {} as JobRepositoryDriver;
      const cadence = createCadence({ driver });

      expect(cadence.getDriver()).toBe(driver);
    });
  });
});
