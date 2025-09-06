import { SharedMutex } from 'async-shared-mutex'

class NotifyingMutex extends SharedMutex {
  public constructor(
    protected onIdle: () => void,
  ) {
    super()
  }

  protected override recordUnlock() {
    super.recordUnlock()
    if (this.lockCount === 0) {
      this.onIdle()
    }
  }
}

export default class KeyedMutex<K = PropertyKey> {
  protected mutexes = new Map<K, NotifyingMutex>()

  public lock(key: K) {
    return this.getMutex(key).lock()
  }

  public tryLock(key: K) {
    return this.getMutex(key).tryLock()
  }

  public lockShared(key: K) {
    return this.getMutex(key).lockShared()
  }

  public tryLockShared(key: K) {
    return this.getMutex(key).tryLockShared()
  }

  protected getMutex(key: K) {
    let mutex = this.mutexes.get(key)
    if (mutex === undefined) {
      mutex = new NotifyingMutex(() => {
        this.mutexes.delete(key)
      })
      this.mutexes.set(key, mutex)
    }

    return mutex
  }
}
