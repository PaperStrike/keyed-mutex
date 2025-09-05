import { test, expect } from '@playwright/test'
import AsyncKeyedMutex from '../src/core/AsyncKeyedMutex'
import { defer } from '../src/utils/ponyfill'
import { sleep } from './helpers/utils'

test.describe('AsyncKeyedMutex', () => {
  test('exclusive tasks run sequentially per key', async () => {
    const km = new AsyncKeyedMutex()
    const events: string[] = []
    const d = defer()

    const p1 = km.lock('k', async () => {
      events.push('A-start')
      await d.promise
      events.push('A-end')
    })

    const p2 = km.lock('k', async () => {
      events.push('B-start')
      await sleep(10)
      events.push('B-end')
    })

    // Let first start
    await sleep(10)
    expect(events).toEqual(['A-start'])

    d.resolve()
    await Promise.all([p1, p2])

    expect(events).toEqual(['A-start', 'A-end', 'B-start', 'B-end'])
  })

  test('different keys execute concurrently (exclusive)', async () => {
    const km = new AsyncKeyedMutex()

    const t0 = Date.now()
    await Promise.all([
      km.lock('k1', async () => { await sleep(80) }),
      km.lock('k2', async () => { await sleep(80) }),
    ])
    const elapsed = Date.now() - t0

    // If concurrent, elapsed should be close to single task time
    expect(elapsed).toBeLessThan(140)
  })

  test('shared tasks on same key run concurrently', async () => {
    const km = new AsyncKeyedMutex()

    const t0 = Date.now()
    await Promise.all([
      km.lockShared('s', async () => { await sleep(80) }),
      km.lockShared('s', async () => { await sleep(80) }),
    ])
    const elapsed = Date.now() - t0

    // Shared should overlap significantly
    expect(elapsed).toBeLessThan(140)
  })

  test('exclusive blocked by shared; proceeds after release', async () => {
    const km = new AsyncKeyedMutex()
    const d1 = defer()
    const d2 = defer()
    const events: string[] = []

    const pS1 = km.lockShared('k', async () => {
      events.push('S1-start')
      await d1.promise
      events.push('S1-end')
    })

    const pS2 = km.lockShared('k', async () => {
      events.push('S2-start')
      await d2.promise
      events.push('S2-end')
    })

    let exclusiveStarted = false
    const pE = km.lock('k', async () => {
      exclusiveStarted = true
      events.push('E-start')
      await sleep(10)
      events.push('E-end')
    })

    await sleep(20)
    expect(exclusiveStarted).toBe(false)

    d1.resolve()
    d2.resolve()
    await Promise.all([pS1, pS2, pE])

    expect(events).toEqual(['S1-start', 'S2-start', 'S1-end', 'S2-end', 'E-start', 'E-end'])
  })

  test('tryLock semantics for exclusive and shared', async () => {
    const km = new AsyncKeyedMutex()
    const hold = defer()

    // Hold exclusive lock
    const pHold = km.lock('t', () => hold.promise)

    // While held, tryLock on same key should fail
    const t1 = await km.tryLock('t', () => 't1')
    expect(t1).toBeNull()

    // Shared try while exclusive held should also fail
    const t2 = await km.tryLockShared('t', () => 't2')
    expect(t2).toBeNull()

    // Different key tryLock should succeed
    const t3 = await km.tryLock('other', () => 't3')
    expect(t3).toBe('t3')

    hold.resolve()
    await pHold

    // After release, tryLockShared should succeed on same key
    const t4 = await km.tryLockShared('t', () => 't4')
    expect(t4).toBe('t4')
  })

  test('shared tryLock succeeds concurrently while exclusive tryLock waits/fails', async () => {
    const km = new AsyncKeyedMutex()
    const d = defer()

    // Hold one shared
    const pS1 = km.lockShared('k', () => d.promise)

    // A second shared tryLock should succeed and run
    const tS2 = await km.tryLockShared('k', () => 'tS2')
    expect(tS2).toBe('tS2')

    // Exclusive tryLock should fail while shared is held
    const tE = await km.tryLock('k', async () => { /* no-op */ })
    expect(tE).toBeNull()

    d.resolve()
    await pS1
  })

  test.describe('gc', () => {
    class TestMutex extends AsyncKeyedMutex {
      public debug() {
        return { mutexRefs: this.mutexRefs }
      }
    }

    test('does not leak per-key state after using many transient keys', async () => {
      const km = new TestMutex()
      const N = 1000

      for (let i = 0; i < N; i++) {
        const key = `temp:${i}`
        await km.lockShared(key, async () => { /* immediate */ })
      }

      // internal bookkeeping should be cleaned up
      const stats = km.debug()
      expect(stats.mutexRefs.size).toBe(0)
    })
  })
})
