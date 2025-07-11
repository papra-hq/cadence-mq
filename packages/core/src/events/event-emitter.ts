export type EventEmitter<EventsTypes extends Record<string, unknown>> = {
  emit: <TEvent extends keyof EventsTypes>(event: TEvent, data: EventsTypes[TEvent]) => void;
  on: <TEvent extends keyof EventsTypes>(event: TEvent, listener: (data: EventsTypes[TEvent]) => void) => void;
};

export function createEventEmitter<EventsTypes extends Record<string, unknown>>(): EventEmitter<EventsTypes> {
  const listeners = new Map<keyof EventsTypes, ((event: EventsTypes[keyof EventsTypes]) => void)[]>();

  return {
    emit: (event, data) => {
      listeners.get(event)?.forEach(listener => listener(data));
    },
    on: (event, listener) => {
      listeners.set(event, [...(listeners.get(event) ?? []), listener as (event: EventsTypes[keyof EventsTypes]) => void]);
    },
  };
}
