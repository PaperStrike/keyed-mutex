import { AsyncSharedMutex, type Task } from 'async-shared-mutex'

export default class AsyncKeyedMutex<K = PropertyKey> {
  protected mutexRefs = new Map<K, [mutex: AsyncSharedMutex, refCount: number]>()

  public async lock<T>(key: K, task: Task<T>) {
    const [mutex, trackedTask] = this.track(key, task)
    return mutex.lock(trackedTask)
  }

  public tryLock<T>(key: K, task: Task<T>) {
    const [mutex, trackedTask] = this.track(key, task)
    return mutex.tryLock(trackedTask)
  }

  public async lockShared<T>(key: K, task: Task<T>) {
    const [mutex, trackedTask] = this.track(key, task)
    return mutex.lockShared(trackedTask)
  }

  public tryLockShared<T>(key: K, task: Task<T>) {
    const [mutex, trackedTask] = this.track(key, task)
    return mutex.tryLockShared(trackedTask)
  }

  protected track<T>(key: K, task: Task<T>): [mutex: AsyncSharedMutex, trackedTask: Task<T>] {
    let mutexRef = this.mutexRefs.get(key)
    if (mutexRef === undefined) {
      mutexRef = [new AsyncSharedMutex(), 0]
      this.mutexRefs.set(key, mutexRef)
    }

    mutexRef[1]++

    const [mutex] = mutexRef
    const trackedTask = async () => {
      try {
        return await task()
      }
      finally {
        const refCount = mutexRef[1]
        if (refCount === 1) {
          this.mutexRefs.delete(key)
        }
        else {
          mutexRef[1] = refCount - 1
        }
      }
    }

    return [mutex, trackedTask]
  }
}
