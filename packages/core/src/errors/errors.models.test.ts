import { describe, expect, test } from 'vitest';
import { safely, serializeError } from './errors.models';

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
});
