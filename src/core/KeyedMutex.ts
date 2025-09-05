import { LockHandle, SharedMutex } from 'async-shared-mutex'

export default class KeyedMutex<K = PropertyKey> {
  protected counts = new Map<K, number>()
  protected mutexes = new Map<K, SharedMutex>()

  public async lock(key: K) {
    this.addCount(key)
    return this.trackLock(key, await this.getMutex(key).lock())
  }

  public tryLock(key: K) {
    const lock = this.getMutex(key).tryLock()
    if (lock === null) return null

    this.addCount(key)
    return this.trackLock(key, lock)
  }

  public async lockShared(key: K) {
    this.addCount(key)
    return this.trackLock(key, await this.getMutex(key).lockShared())
  }

  public tryLockShared(key: K) {
    const lock = this.getMutex(key).tryLockShared()
    if (lock === null) return null

    this.addCount(key)
    return this.trackLock(key, lock)
  }

  protected addCount(key: K) {
    this.counts.set(key, (this.counts.get(key) ?? 0) + 1)
  }

  protected subCount(key: K) {
    const count = this.counts.get(key)!
    if (count === 1) {
      this.counts.delete(key)
      this.mutexes.delete(key)
    }
    else {
      this.counts.set(key, count - 1)
    }
  }

  protected trackLock(key: K, lock: LockHandle) {
    let unlocked = false
    return new LockHandle(() => {
      if (unlocked) return
      unlocked = true

      this.subCount(key)
      lock.unlock()
    })
  }

  protected getMutex(key: K) {
    let mutex = this.mutexes.get(key)
    if (!mutex) {
      mutex = new SharedMutex()
      this.mutexes.set(key, mutex)
    }

    return mutex
  }
}
