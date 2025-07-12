import { describe, expect, test } from 'vitest';
import { createEventEmitter } from './event-emitter';

describe('event-emitter', () => {
  describe('createEventEmitter', () => {
    test('event listeners are called when the event is emitted', () => {
      const ee = createEventEmitter();
      const eventArgs: unknown[] = [];

      ee.on('user.created', (data) => {
        eventArgs.push(data);
      });

      ee.emit('user.created', { name: 'John' });

      expect(eventArgs).toEqual([{ name: 'John' }]);
    });

    test('a listener can be removed using the off method', () => {
      const ee = createEventEmitter();
      const eventArgs: unknown[] = [];

      const listener = (data: unknown) => {
        eventArgs.push(data);
      };

      ee.on('user.created', listener);
      ee.emit('user.created', { name: 'John' });

      expect(eventArgs).toEqual([{ name: 'John' }]);

      ee.off('user.created', listener);
      ee.emit('user.created', { name: 'Jane' });

      expect(eventArgs).toEqual([{ name: 'John' }]);
    });

    test('when trying to remove a listener that was not added, nothing happens', () => {
      const ee = createEventEmitter();
      const eventArgs: unknown[] = [];

      const listener = (data: unknown) => {
        eventArgs.push(data);
      };

      ee.off('user.created', listener);
      ee.emit('user.created', { name: 'John' });

      expect(eventArgs).toEqual([]);
    });
  });
});
