import type { LockHandle } from 'async-shared-mutex'
import KeyedMutex from './KeyedMutex'

/**
 * A function to be scheduled for execution.
 */
export type Task<T> = () => (T | PromiseLike<T>)

export default class AsyncKeyedMutex<K = PropertyKey> {
  protected keyedMutex = new KeyedMutex<K>()

  public async lock<T>(key: K, task: Task<T>) {
    const lck = await this.keyedMutex.lock(key)
    return this.run(lck, task)
  }

  public tryLock<T>(key: K, task: Task<T>) {
    const lck = this.keyedMutex.tryLock(key)
    return lck !== null
      ? this.run(lck, task)
      : null
  }

  public async lockShared<T>(key: K, task: Task<T>) {
    const lck = await this.keyedMutex.lockShared(key)
    return this.run(lck, task)
  }

  public tryLockShared<T>(key: K, task: Task<T>) {
    const lck = this.keyedMutex.tryLockShared(key)
    return lck !== null
      ? this.run(lck, task)
      : null
  }

  private async run<T>(handle: LockHandle, task: Task<T>): Promise<T> {
    try {
      return await task()
    }
    finally {
      handle.unlock()
    }
  }
}
