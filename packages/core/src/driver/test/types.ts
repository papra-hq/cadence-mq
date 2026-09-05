import type { Driver } from '../driver';

export type DriverTestSuiteOptions = {
  createDriver: () => Driver | PromiseLike<Driver>;
  timeout?: number;
};

export type DriverTestSuiteContext = {
  createDriver: DriverTestSuiteOptions['createDriver'];
  testOptions: { timeout?: number };
};
