import { test, expect } from '@playwright/test'
import KeyedMutex from '../src/core/KeyedMutex'
import { sleep } from './helpers/utils'

test.describe('KeyedMutex', () => {
  test('basic lock and idempotent unlock', async () => {
    const mutex = new KeyedMutex()
    const lock = await mutex.lock('a')
    expect(lock).toBeTruthy()
    // unlock twice should be safe (idempotent)
    lock.unlock()
    lock.unlock()
  })

  test('mutual exclusion per key; independent keys', async () => {
    const mutex = new KeyedMutex()

    const lockA1 = await mutex.lock('a')
    // cannot acquire second exclusive on same key
    const tryA2 = mutex.tryLock('a')
    expect(tryA2).toBeNull()

    // different key is independent
    const lockB = mutex.tryLock('b')
    expect(lockB).not.toBeNull()

    lockB!.unlock()
    lockA1.unlock()
  })

  test('shared locks allow concurrency; exclusive waits', () => {
    const mutex = new KeyedMutex()

    const s1 = mutex.tryLockShared('k')
    const s2 = mutex.tryLockShared('k')
    expect(s1).not.toBeNull()
    expect(s2).not.toBeNull()

    // while shared locks are held, exclusive cannot be acquired
    const eTry = mutex.tryLock('k')
    expect(eTry).toBeNull()

    s1!.unlock()
    s2!.unlock()

    const e = mutex.tryLock('k')
    expect(e).not.toBeNull()
    e!.unlock()
  })

  test('exclusive blocks shared; shared after release', async () => {
    const mutex = new KeyedMutex()

    const e = await mutex.lock('x')
    const sTry = mutex.tryLockShared('x')
    expect(sTry).toBeNull()

    e.unlock()

    const s = mutex.tryLockShared('x')
    expect(s).not.toBeNull()
    s!.unlock()
  })

  test('lock waits until previous exclusive is released (ordering)', async () => {
    const mutex = new KeyedMutex()

    const l1 = await mutex.lock('q')
    let acquiredSecond = false

    const p2 = mutex.lock('q').then((l2) => {
      acquiredSecond = true
      l2.unlock()
    })

    await sleep(30)
    expect(acquiredSecond).toBe(false)

    l1.unlock()
    await p2
    expect(acquiredSecond).toBe(true)
  })

  test('shared locks can overlap while waiting exclusive does not resolve early', async () => {
    const mutex = new KeyedMutex()

    const s1 = await mutex.lockShared('y')
    const pS2 = mutex.lockShared('y') // should resolve while s1 is held
    const pE = mutex.lock('y') // should wait

    const s2 = await pS2
    let exclusiveResolved = false
    void pE.finally(() => {
      exclusiveResolved = true
    })

    await sleep(20)
    expect(exclusiveResolved).toBe(false)

    s1.unlock()
    s2.unlock()

    const e = await pE
    e.unlock()
  })

  test.describe('gc', () => {
    class TestMutex extends KeyedMutex {
      public debug() {
        return { mutexRefs: this.mutexRefs }
      }
    }

    test('does not leak per-key state after using many transient keys', async () => {
      const mutex = new TestMutex()
      const N = 1000

      for (let i = 0; i < N; i++) {
        const key = `temp:${i}`
        const h = await mutex.lockShared(key)
        h.unlock()
      }

      // internal bookkeeping should be cleaned up
      expect(mutex.debug().mutexRefs.size).toBe(0)
    })

    test('tryLock failure does not leak per-key state', async () => {
      const mutex = new TestMutex()
      const key = 'leak:test'

      // hold an exclusive lock so tryLock should fail
      const h = await mutex.lock(key)
      expect(h).toBeTruthy()

      // map should contain the key while held
      expect(mutex.debug().mutexRefs.size).toBe(1)

      const tE = mutex.tryLock(key)
      expect(tE).toBeNull()

      const tS = mutex.tryLockShared(key)
      expect(tS).toBeNull()

      // failed tries should not have left extra entries
      expect(mutex.debug().mutexRefs.size).toBe(1)

      h.unlock()

      // after release internal state should be cleaned
      expect(mutex.debug().mutexRefs.size).toBe(0)
    })
  })
})
