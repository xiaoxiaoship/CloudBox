/**
 * 用户级互斥锁：同一用户的写操作（上传/删除/重命名）串行执行，
 * 避免并发上传在"检查配额 → 写入 → 更新用量"之间产生超卖。
 *
 * 实现要点：每个 key 维护一个"闸门"Promise，后来者等待前一个释放；
 * 任务抛错也会在 finally 中释放，不会出现死锁。
 */
export class KeyedMutex {
  private readonly tails = new Map<number, Promise<void>>();

  async runExclusive<T>(key: number, task: () => Promise<T>): Promise<T> {
    const previous = this.tails.get(key) ?? Promise.resolve();

    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });

    const tail = previous.then(() => gate);
    this.tails.set(key, tail);

    await previous;
    try {
      return await task();
    } finally {
      release();
      if (this.tails.get(key) === tail) {
        this.tails.delete(key);
      }
    }
  }
}
