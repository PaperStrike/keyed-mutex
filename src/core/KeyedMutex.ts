import { LockHandle, SharedMutex } from 'async-shared-mutex'

export default class KeyedMutex<K = PropertyKey> {
  protected mutexRefs = new Map<K, [mutex: SharedMutex, refCount: number]>()

  public async lock(key: K) {
    const [mutex, subCount] = this.track(key)
    return this.trackLock(await mutex.lock(), subCount)
  }

  public tryLock(key: K) {
    const [mutex, subCount] = this.track(key)
    const lock = mutex.tryLock()
    if (lock === null) {
      subCount()
      return null
    }

    return this.trackLock(lock, subCount)
  }

  public async lockShared(key: K) {
    const [mutex, subCount] = this.track(key)
    return this.trackLock(await mutex.lockShared(), subCount)
  }

  public tryLockShared(key: K) {
    const [mutex, subCount] = this.track(key)
    const lock = mutex.tryLockShared()
    if (lock === null) {
      subCount()
      return null
    }

    return this.trackLock(lock, subCount)
  }

  protected track(key: K): [mutex: SharedMutex, subRef: () => void] {
    let mutexRef = this.mutexRefs.get(key)
    if (mutexRef === undefined) {
      mutexRef = [new SharedMutex(), 0]
      this.mutexRefs.set(key, mutexRef)
    }

    // increase ref count
    mutexRef[1]++

    // decrease ref count
    const subRef = () => {
      const refCount = mutexRef[1]
      if (refCount === 1) {
        this.mutexRefs.delete(key)
      }
      else {
        mutexRef[1] = refCount - 1
      }
    }

    const [mutex] = mutexRef

    return [mutex, subRef]
  }

  protected trackLock(lock: LockHandle, subCount: () => void) {
    let unlocked = false
    return new LockHandle(() => {
      if (unlocked) return
      unlocked = true

      subCount()
      lock.unlock()
    })
  }
}
