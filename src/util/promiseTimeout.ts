export class PromiseTimeoutError extends Error {
  constructor(label: string, ms: number) {
    super(`${label} timed out after ${ms}ms`);
    this.name = 'PromiseTimeoutError';
  }
}

export function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  label = 'operation'
): Promise<T> {
  const timeoutMs = Math.max(1, Number(ms) || 1);
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new PromiseTimeoutError(label, timeoutMs));
    }, timeoutMs);
    Promise.resolve(promise).then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      }
    );
  });
}
