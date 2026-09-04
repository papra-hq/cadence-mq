import { describe, expect, test } from 'vitest';
import { CadenceError } from '../../errors/errors.models';
import { PermanentTaskError } from '../handlers/permanent-task-error';
import { serializeJobError } from './serialize-job-error';

describe('PermanentTaskError', () => {
  test('the public error identifies a handler outcome as permanent while retaining its cause', () => {
    const cause = new Error('root cause');
    const error = new PermanentTaskError('do not retry', { cause });

    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe('PermanentTaskError');
    expect(error.message).toBe('do not retry');
    expect(error.cause).toBe(cause);
  });
});

describe('serializeJobError', () => {
  test('error details and string codes are retained without recursively persisting causes', () => {
    const error = new CadenceError({
      code: 'delivery.rejected',
      message: 'Delivery was rejected',
      cause: new Error('private cause'),
    });
    error.stack = 'serialized stack';

    const serialized = serializeJobError(error);

    expect(serialized).toEqual({
      name: 'CadenceError',
      message: 'Delivery was rejected',
      stack: 'serialized stack',
      code: 'delivery.rejected',
    });
    expect(serialized).not.toHaveProperty('cause');
  });

  test.each([
    ['a string', 'rejected', 'rejected'],
    ['undefined', undefined, 'undefined'],
    ['null', null, 'null'],
    ['a number', 42, '42'],
    ['a plain object', { reason: 'rejected' }, '{"reason":"rejected"}'],
  ])('%s thrown value is converted to an Error-shaped record', (_title, thrown, message) => {
    expect(serializeJobError(thrown)).toEqual({
      name: 'Error',
      message,
    });
  });

  test('error-like thrown objects retain their safe string properties', () => {
    expect(
      serializeJobError({
        name: 'DeliveryError',
        message: 'rejected',
        stack: 'remote stack',
        code: 'delivery.rejected',
      }),
    ).toEqual({
      name: 'DeliveryError',
      message: 'rejected',
      stack: 'remote stack',
      code: 'delivery.rejected',
    });
  });

  test('hostile thrown values cannot make error serialization fail', () => {
    const hostile = new Proxy(
      {},
      {
        get: () => {
          throw new Error('property access failed');
        },
      },
    );

    expect(serializeJobError(hostile)).toEqual({
      name: 'Error',
      message: 'Unknown error',
    });
  });
});
