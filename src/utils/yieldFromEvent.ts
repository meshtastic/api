import type { SubEvent } from "sub-events";

export function yieldFromEvent<T, K>(
  event: SubEvent<T>,
  generator: (data: T) => K,
): AsyncGenerator<K> {
  return {
    next: async () => {
      const value = await new Promise<K>((resolve) => {
        event.subscribe((e) => {
          resolve(generator(e));
        });
      });

      return { value, done: false };
    },
    async return() {
      return await Promise.resolve({ value: undefined, done: true });
    },
    throw(error) {
      return Promise.reject(error);
    },
    [Symbol.asyncIterator]() {
      return this;
    },
  };
}
