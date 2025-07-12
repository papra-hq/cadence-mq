import { describe, expect, test } from 'vitest';
import * as exported from './index';

describe('core', () => {
  test('the exports are fixed', () => {
    expect(Object.keys(exported)).toMatchInlineSnapshot(`
      [
        "createCadence",
        "createJobNotFoundError",
        "createJobWithSameIdExistsError",
        "createError",
        "createErrorFactory",
        "isCadenceError",
        "createScheduler",
        "scheduleJob",
        "createTaskRegistry",
        "createWorker",
      ]
    `);
  });
});
