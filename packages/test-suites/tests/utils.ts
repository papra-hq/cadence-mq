export function createIdGenerator() {
  let id = 0;

  return () => String(id++);
}

export const waitNextEventLoop = () => new Promise(resolve => setImmediate(resolve));
