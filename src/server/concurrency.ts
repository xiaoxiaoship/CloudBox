export class ConcurrencyGate {
  private active = 0;
  private readonly waiters: Array<() => void> = [];

  async run<T>(limit: number, task: () => Promise<T>, timeoutMs?: number): Promise<T> {
    await this.acquire(limit, timeoutMs);
    try {
      return await task();
    } finally {
      this.release(limit);
    }
  }

  private acquire(limit: number, timeoutMs?: number): Promise<void> {
    const max = Math.max(1, Math.trunc(limit));
    if (this.active < max) {
      this.active += 1;
      return Promise.resolve();
    }
    return new Promise<void>((resolve, reject) => {
      let timer: NodeJS.Timeout | null = null;
      const waiter = (): void => {
        if (timer !== null) clearTimeout(timer);
        this.active += 1;
        resolve();
      };
      this.waiters.push(waiter);
      if (timeoutMs !== undefined) {
        timer = setTimeout(() => {
          const index = this.waiters.indexOf(waiter);
          if (index >= 0) this.waiters.splice(index, 1);
          reject(new Error('concurrency_timeout'));
        }, timeoutMs);
      }
    });
  }

  private release(limit: number): void {
    this.active = Math.max(0, this.active - 1);
    while (this.active < Math.max(1, Math.trunc(limit)) && this.waiters.length > 0) {
      this.waiters.shift()?.();
    }
  }
}

export const extractionGate = new ConcurrencyGate();
export const scanGate = new ConcurrencyGate();
export const heavyPreviewGate = new ConcurrencyGate();
const previewGates = new Map<number, ConcurrencyGate>();

export function previewGateForUser(userId: number): ConcurrencyGate {
  let gate = previewGates.get(userId);
  if (!gate) {
    gate = new ConcurrencyGate();
    previewGates.set(userId, gate);
  }
  return gate;
}
