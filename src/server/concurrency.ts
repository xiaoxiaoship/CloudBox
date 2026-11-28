export interface QueueTicket {
  promise: Promise<void>;
  cancel: () => void;
  release: () => void;
}

interface Waiter {
  resolve: () => void;
  reject: (error: Error) => void;
}

export class ConcurrencyGate {
  private active = 0;
  private readonly waiters: Waiter[] = [];

  /**
   * 排队执行。onQueued 会在进入等待队列时回调当前排位（1 表示队首）。
   * ticket.cancel 用于取消仍在排队的任务，取消后会从 waiters 物理移除。
   */
  enqueue(
    limit: number,
    timeoutMs?: number,
    onQueued?: (position: number) => void,
  ): QueueTicket {
    const max = Math.max(1, Math.trunc(limit));
    let settled = false;
    let acquired = false;
    let released = false;
    let timer: NodeJS.Timeout | null = null;
    let waiter: Waiter | null = null;

    const cleanupTimer = (): void => {
      if (timer !== null) clearTimeout(timer);
      timer = null;
    };

    const promise = new Promise<void>((resolve, reject) => {
      if (this.active < max) {
        this.active += 1;
        acquired = true;
        resolve();
        return;
      }

      waiter = {
        resolve: () => {
          if (settled) return;
          settled = true;
          acquired = true;
          cleanupTimer();
          this.active += 1;
          resolve();
        },
        reject: (error) => {
          if (settled) return;
          settled = true;
          cleanupTimer();
          reject(error);
        },
      };
      this.waiters.push(waiter);
      onQueued?.(this.waiters.length);
      if (timeoutMs !== undefined) {
        timer = setTimeout(() => {
          const index = this.waiters.indexOf(waiter!);
          if (index >= 0) this.waiters.splice(index, 1);
          waiter?.reject(new Error('concurrency_timeout'));
        }, timeoutMs);
        timer.unref?.();
      }
    });

    return {
      promise,
      release: () => {
        if (!acquired || released) return;
        released = true;
        this.release(limit);
      },
      cancel: () => {
        if (settled) return;
        if (waiter !== null) {
          const index = this.waiters.indexOf(waiter);
          if (index >= 0) this.waiters.splice(index, 1);
          waiter.reject(new Error('concurrency_cancelled'));
          return;
        }
        settled = true;
        cleanupTimer();
      },
    };
  }

  async run<T>(
    limit: number,
    task: () => Promise<T>,
    timeoutMs?: number,
    onQueued?: (position: number) => void,
  ): Promise<T> {
    const ticket = this.enqueue(limit, timeoutMs, onQueued);
    await ticket.promise;
    try {
      return await task();
    } finally {
      ticket.release();
    }
  }

  private release(limit: number): void {
    this.active = Math.max(0, this.active - 1);
    while (this.active < Math.max(1, Math.trunc(limit)) && this.waiters.length > 0) {
      this.waiters.shift()?.resolve();
    }
  }
}

export const extractionGate = new ConcurrencyGate();
export const scanGate = new ConcurrencyGate();
export const compressionGate = new ConcurrencyGate();
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
