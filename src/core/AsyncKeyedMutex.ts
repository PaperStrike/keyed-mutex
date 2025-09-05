import { AsyncSharedMutex, type Task } from 'async-shared-mutex'

export default class AsyncKeyedMutex<K = PropertyKey> {
  protected mutexRefs = new Map<K, [mutex: AsyncSharedMutex, refCount: number]>()

  public async lock<T>(key: K, task: Task<T>) {
    const [mutex, trackedTask] = this.track(key, task)
    return mutex.lock(trackedTask)
  }

  public tryLock<T>(key: K, task: Task<T>) {
    const [mutex, trackedTask, subRef] = this.track(key, task)
    const result = mutex.tryLock(trackedTask)
    if (result === null) subRef()
    return result
  }

  public async lockShared<T>(key: K, task: Task<T>) {
    const [mutex, trackedTask] = this.track(key, task)
    return mutex.lockShared(trackedTask)
  }

  public tryLockShared<T>(key: K, task: Task<T>) {
    const [mutex, trackedTask, subRef] = this.track(key, task)
    const result = mutex.tryLockShared(trackedTask)
    if (result === null) subRef()
    return result
  }

  protected track<T>(key: K, task: Task<T>): [mutex: AsyncSharedMutex, trackedTask: Task<T>, subRef: () => void] {
    let mutexRef = this.mutexRefs.get(key)
    if (mutexRef === undefined) {
      mutexRef = [new AsyncSharedMutex(), 0]
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

    // wrap task to decrease ref count after it's done
    const trackedTask = async () => {
      try {
        return await task()
      }
      finally {
        subRef()
      }
    }

    const [mutex] = mutexRef

    return [mutex, trackedTask, subRef]
  }
}
