// Rejects with a TimeoutError when a promise does not settle within `ms` milliseconds.

export class TimeoutError extends Error {
  constructor(message) {
    super(message);
    this.name = 'TimeoutError';
    this.code = 'ETIMEDOUT';
  }
}

/**
 * @template T
 * @param {Promise<T> | T} promise
 * @param {number} ms
 * @param {string} [message]
 * @returns {Promise<T>}
 */
export function withTimeout(promise, ms, message = `Timed out after ${ms} ms`) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new TimeoutError(message)), ms);
  });
  // Promise.race attaches handlers to `promise`, so a late rejection is never unhandled.
  return Promise.race([Promise.resolve(promise), timeout]).finally(() => clearTimeout(timer));
}
