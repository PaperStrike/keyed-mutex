# keyed-mutex

Lightweight keyed mutex for TypeScript / ESM — provide per-key mutual exclusion and reader/writer semantics so different keys can be locked independently while preserving fairness for writers.

This repository implements two complementary APIs:

* `KeyedMutex` – low‑level handle based API (you manage the critical section) for locks keyed by an arbitrary string (or other key).
* `AsyncKeyedMutex` – convenience API that runs a function while holding the mutex for a specific key.

Both support shared (concurrent/read) and exclusive (mutating/write) acquisition scoped to a single key.

## Quick start (task style)

```ts
import { AsyncKeyedMutex } from 'keyed-mutex'

const mtx = new AsyncKeyedMutex()

// Exclusive (writer) for a specific key
await mtx.lock('user:42', async () => {
  // only one task may run for key 'user:42'
  await doWrite()
})

// Shared (reader) – many may run together for the same key
const [a, b, c] = await Promise.all([
  mtx.lockShared('user:42', () => readValue('a')),
  mtx.lockShared('user:42', () => readValue('b')),
  mtx.lockShared('user:42', () => readValue('c')),
])
```

Because locks are keyed, operations for different keys proceed independently and concurrently.

## Quick start (handle style)

```ts
import { KeyedMutex } from 'keyed-mutex'

const mtx = new KeyedMutex()

// Exclusive for a key
const exclusive = await mtx.lock('session:abc')
try {
  await doWrite()
}
finally {
  exclusive.unlock()
}

// Shared for a key
const shared = await mtx.lockShared('session:abc')
try {
  const v = await readValue()
  console.log(v)
}
finally {
  shared.unlock()
}
```

### With TypeScript `using` (TS 5.2+)

```ts
import { KeyedMutex } from 'keyed-mutex'
const mtx = new KeyedMutex()

async function update() {
  using lock = await mtx.lock('doc:1') // unlocks automatically at end of scope
  await mutate()
}
```

> If your runtime lacks native `Symbol.dispose`, add a small polyfill or call `unlock()` manually.

## When to use

Use when you need to coordinate access to resources partitioned by key, for example:

* Per-user or per-session locks in a server.
* Per-document or per-record concurrency control in a cache or in-memory datastore.
* Allow many readers for the same key while ensuring exclusive writers run alone.

Because keys are independent, a heavy writer on one key won't block unrelated keys.

## Semantics

* Shared acquisitions for a key overlap with other shared acquisitions for the same key if no earlier exclusive is pending for that key.
* An exclusive for a key waits for currently active (or already queued before it) shared holders for the same key to finish, then runs alone.
* Shared acquisitions requested after an exclusive has queued for the same key must wait until that exclusive finishes.
* Exclusives for the same key are serialized in request order.
* Errors inside a task propagate; the lock for that key is still released.
* `try*` variants attempt instantaneous acquisition and return `null` if not immediately possible (no queuing side effects).

This provides predictable writer progress per key while still batching readers that arrive before the next writer.

## Memory / cleanup

To avoid memory leaks the mutex clears its internal per-key bookkeeping (maps/queues) as soon as a key has no active holders and no pending requests. That means using many short‑lived keys won't leave lingering entries — only keys with active holders or queued requests consume memory.

Example — transient keys are cleaned up after release

```ts
import { KeyedMutex } from 'keyed-mutex'

const mtx = new KeyedMutex<string>()

// create and immediately release many short-lived keys
for (let i = 0; i < 1000; i++) {
  const key = `temp:${i}`
  const h = await mtx.lockShared(key)
  h.unlock()
}

// Internal bookkeeping for `temp:*` keys is removed once each key has no holders/requests.
```

No manual cleanup API is required.

## API

### `class KeyedMutex<K = PropertyKey>`

Low level; you get locks you must unlock. Locks are scoped to a key `K`.

| Method | Returns | Description |
| ------ | ------- | ----------- |
| `lock(key: K)` | `Promise<LockHandle>` | Await an exclusive (writer) handle for `key`. |
| `tryLock(key: K)` | `LockHandle \| null` | Immediate exclusive attempt for `key`. `null` if busy. |
| `lockShared(key: K)` | `Promise<LockHandle>` | Await a shared (reader) handle for `key`. |
| `tryLockShared(key: K)` | `LockHandle \| null` | Immediate shared attempt for `key` (fails if an exclusive is active/pending for that key). |

`LockHandle`:

* `unlock(): void` – idempotent; may be called multiple times.
* `[Symbol.dispose]()` – same as `unlock()` enabling `using`.

### `class AsyncKeyedMutex<K = PropertyKey>`

Higher-level runner that executes a function while holding a keyed lock.

| Method | Returns | Description |
| ------ | ------- | ----------- |
| `lock(key, task)` | `Promise<T>` | Run `task` exclusively for `key`. |
| `tryLock(key, task)` | `Promise<T> \| null` | Immediate exclusive attempt for `key`. If acquired, runs `task`; else `null`. |
| `lockShared(key, task)` | `Promise<T>` | Run `task` under a shared lock for `key`. |
| `tryLockShared(key, task)` | `Promise<T> \| null` | Immediate shared attempt for `key`. |

`task` signature: `() => T | PromiseLike<T>`

### Error handling

If `task` throws / rejects, the keyed lock is released and the error is re-thrown. No additional wrapping.

## Patterns

Debounce writes while permitting many simultaneous reads per key:

```ts
const state = new AsyncKeyedMutex<string>()
let cache: Record<string, Data>

export const readState = (id: string) => state.lockShared(id, () => cache[id])
export const updateState = (id: string, patch: Partial<Data>) => state.lock(id, async () => {
  cache[id] = { ...cache[id], ...patch }
})
```

Fast read path that falls back to waiting if a writer is in flight for the same key:

```ts
const mtx = new KeyedMutex<string>()

export async function getSnapshot(key: string) {
  const h = mtx.tryLockShared(key) || await mtx.lockShared(key)
  try {
    return snapshotForKey(key)
  }
  finally {
    h.unlock()
  }
}
```

## Target

Modern Node / browsers, ES2022.

## Limitations / Notes

* Not reentrant for the same key – calling lock methods for the same key from inside an already held lock will deadlock (no detection performed).
* Fairness beyond the described ordering is not attempted (e.g., readers arriving while a long queue of writers exists for a key will wait until those writers finish).
* No timeout / cancellation primitive provided. Compose with `AbortController` in your tasks if required.

## Comparison

| | `KeyedMutex` | `AsyncKeyedMutex` |
| - | - | - |
| Style | Manual handles scoped to a key | Higher level task runner scoped to a key |
| Cleanup | Call `unlock()` / `using` | Automatic around function |
| Overhead | Slightly lower | Wrapper promise per task |

## License

MIT

---

Feedback and PRs welcome — ideas: timeouts, cancellation helpers, metrics, or stronger typing for keys.
