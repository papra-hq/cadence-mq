export function createIdGenerator() {
  let id = 0;

  return () => String(id++);
}

export const waitNextEventLoop = () => new Promise(resolve => setImmediate(resolve));
// export const waitNextEventLoop = () => new Promise(resolve => Promise.resolve().then(resolve));
