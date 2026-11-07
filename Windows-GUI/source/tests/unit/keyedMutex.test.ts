import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { KeyedMutex } from '../../src/core/fs/keyedMutex.ts';

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe('KeyedMutex', () => {
  it('同一 key 串行执行', async () => {
    const mutex = new KeyedMutex();
    const order: string[] = [];

    const first = mutex.runExclusive(1, async () => {
      order.push('first-start');
      await delay(30);
      order.push('first-end');
      return 'first';
    });
    const second = mutex.runExclusive(1, async () => {
      order.push('second');
      return 'second';
    });

    const [a, b] = await Promise.all([first, second]);
    assert.equal(a, 'first');
    assert.equal(b, 'second');
    assert.deepEqual(order, ['first-start', 'first-end', 'second']);
  });

  it('任务抛错后仍会释放锁', async () => {
    const mutex = new KeyedMutex();

    await assert.rejects(
      mutex.runExclusive(1, async () => {
        throw new Error('boom');
      }),
      /boom/,
    );

    assert.equal(await mutex.runExclusive(1, async () => 'after-error'), 'after-error');
  });

  it('不同 key 互不阻塞', async () => {
    const mutex = new KeyedMutex();
    let releaseFirst!: () => void;
    const gate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });

    const first = mutex.runExclusive(1, async () => {
      await gate;
      return 'first';
    });

    let secondStarted = false;
    const second = mutex.runExclusive(2, async () => {
      secondStarted = true;
      return 'second';
    });

    assert.equal(await second, 'second');
    assert.equal(secondStarted, true);

    releaseFirst();
    assert.equal(await first, 'first');
  });

  it('前一个任务排队期间，后续任务不会插队', async () => {
    const mutex = new KeyedMutex();
    const order: number[] = [];

    const tasks = [1, 2, 3].map((index) =>
      mutex.runExclusive(7, async () => {
        order.push(index);
        await delay(5);
      }),
    );

    await Promise.all(tasks);
    assert.deepEqual(order, [1, 2, 3]);
  });
});
