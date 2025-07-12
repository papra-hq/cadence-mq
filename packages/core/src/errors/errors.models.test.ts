import { describe, expect, test } from 'vitest';
import { CadenceError, createError, createErrorFactory, isCadenceError, safely, serializeError } from './errors.models';

describe('errors models', () => {
  describe('serializeError', () => {
    test('when the prodived error is a true error instance concatenates the message and the stack', () => {
      const error = new Error('test');
      error.stack = 'Error: test\nstack';

      expect(serializeError({ error })).toBe('test\n\nError: test\nstack');
    });

    test('objects and arrays are serialized as JSON', () => {
      expect(serializeError({ error: { message: 'test', stack: 'Error: test\nstack' } })).toBe('{"message":"test","stack":"Error: test\\nstack"}');
      expect(serializeError({ error: ['foo', 'bar'] })).toBe('["foo","bar"]');
      expect(serializeError({ error: [1, 2, 3] })).toBe('[1,2,3]');
      expect(serializeError({ error: {} })).toBe('{}');
      expect(serializeError({ error: [] })).toBe('[]');
    });

    test('when the prodived error is something else, serializes it as a string', () => {
      expect(serializeError({ error: 'test' })).toBe('test');
      expect(serializeError({ error: 123 })).toBe('123');
      expect(serializeError({ error: true })).toBe('true');
      expect(serializeError({ error: false })).toBe('false');
      expect(serializeError({ error: null })).toBe('null');
      expect(serializeError({ error: undefined })).toBe('undefined');
    });
  });

  describe('safely', () => {
    describe('functional dx helper to reduce indentation hell due to try/catch', () => {
      test('given a promise, returns a tuple with the error and the result', async () => {
        expect(
          await safely(Promise.resolve('test')),
        ).to.eql(
          [undefined, 'test'],
        );

        expect(
          await safely(Promise.reject(new Error('test'))),
        ).to.eql(
          [new Error('test'), undefined],
        );

        expect(
          // eslint-disable-next-line prefer-promise-reject-errors
          await safely(Promise.reject(123)),
        ).to.eql(
          [new Error('123'), undefined],
        );
      });
    });
  });

  describe('cadence error', () => {
    describe('isCadenceError', () => {
      test('type guard against CadenceError', () => {
        expect(isCadenceError(createError({ message: 'test', code: 'test' }))).toBe(true);
        expect(isCadenceError(new CadenceError({ message: 'test', code: 'test' }))).toBe(true);
        expect(isCadenceError(new Error('test'))).toBe(false);
        expect(isCadenceError('test')).toBe(false);
      });
    });

    describe('createError', () => {
      test('functional builder for CadenceError', () => {
        const error = createError({ message: 'test', code: 'test' });
        expect(error).toBeInstanceOf(CadenceError);
        expect(error.message).toBe('test');
        expect(error.code).toBe('test');
        expect(error.cause).toBeUndefined();
        expect(error.name).toBe('CadenceError');
        expect(error.stack).toBeDefined();
      });
    });

    describe('createErrorFactory', () => {
      test('functional factory for CadenceError', () => {
        const errorFactory = createErrorFactory({ code: 'test', message: 'test' });
        const error = errorFactory();
        expect(error).toBeInstanceOf(CadenceError);
        expect(error.message).toBe('test');
        expect(error.code).toBe('test');
        expect(error.cause).toBeUndefined();
        expect(error.name).toBe('CadenceError');
        expect(error.stack).toBeDefined();
      });

      test('can override the message and the cause', () => {
        const errorFactory = createErrorFactory({ code: 'test', message: 'test' });
        const cause = new Error('cause');
        const error = errorFactory({ message: 'test2', cause });
        expect(error).toBeInstanceOf(CadenceError);
        expect(error.message).toBe('test2');
        expect(error.code).toBe('test');
        expect(error.cause).toEqual(cause);
      });
    });
  });
});
