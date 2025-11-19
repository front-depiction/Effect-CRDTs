# Effect-CRDTs

Effectful CRDTs (Conflict-free Replicated Data Types) using Effect's Graph and STM modules.

## Overview

Effect-CRDTs provides a collection of production-ready CRDT implementations built on top of the Effect ecosystem. All operations are transactional (using STM), composable, and designed for distributed systems that require strong eventual consistency.

## Features

- **Transactional Operations**: All CRDT operations use STM for atomic, composable updates
- **Type-Safe**: Full TypeScript support with Effect's type system
- **Pluggable Persistence**: Abstract persistence layer for various storage backends
- **Dependency Injection**: Context-based service design using Effect Layers
- **Property-Based Testing**: Verified CRDT laws (commutativity, associativity, idempotence)
- **Graph-Based Causality**: Leverages Effect's Graph module for causal tracking (upcoming)

## Installation

```bash
npm install effect-crdts effect
```

## Implemented CRDTs

### Counters

- **G-Counter** (Grow-only Counter): Increment-only counter for distributed counting
- **PN-Counter** (Positive-Negative Counter): Counter supporting both increment and decrement

### Sets

- **G-Set** (Grow-only Set): Add-only set with union-based merge

### Coming Soon

- **2P-Set** (Two-Phase Set): Add and remove with tombstones
- **OR-Set** (Observed-Remove Set): Add and remove with unique tags
- **LWW-Register** (Last-Write-Wins Register): Single-value register with timestamps
- **LWW-Map** (Last-Write-Wins Map): Key-value map with LWW semantics
- **RGA** (Replicated Growable Array): Ordered sequence CRDT

## Quick Start

### G-Counter Example

```typescript
import * as Effect from "effect/Effect"
import * as STM from "effect/STM"
import { GCounter, ReplicaId } from "effect-crdts"

const program = Effect.gen(function* () {
  const counter = yield* GCounter.Tag

  // Increment the counter (STM operations auto-commit when yielded in Effect.gen)
  yield* GCounter.increment(counter, 5)
  yield* GCounter.increment(counter, 3)

  // Get the current value
  const value = yield* GCounter.value(counter)
  console.log("Counter value:", value) // 8
})

// Run with a layer providing the GCounter service
Effect.runPromise(
  program.pipe(Effect.provide(GCounter.Live(ReplicaId("replica-1"))))
)
```

### Multi-Replica Synchronization

```typescript
import * as Effect from "effect/Effect"
import * as STM from "effect/STM"
import { GCounter, ReplicaId } from "effect-crdts"

const program = Effect.gen(function* () {
  // Create two replicas
  const replica1 = yield* GCounter.make(ReplicaId("replica-1"))
  const replica2 = yield* GCounter.make(ReplicaId("replica-2"))

  // Each replica increments independently
  yield* GCounter.increment(replica1, 10)
  yield* GCounter.increment(replica2, 20)

  // Synchronize replicas by merging state
  const state2 = yield* GCounter.query(replica2)
  yield* GCounter.merge(replica1, state2)

  // Both replicas now converge to the same value
  const value = yield* GCounter.value(replica1)
  console.log("Converged value:", value) // 30
})

Effect.runPromise(program)
```

### PN-Counter with Increments and Decrements

```typescript
import * as Effect from "effect/Effect"
import * as STM from "effect/STM"
import { PNCounter, ReplicaId } from "effect-crdts"

const program = Effect.gen(function* () {
  const counter = yield* PNCounter.Tag

  yield* PNCounter.increment(counter, 10)
  yield* PNCounter.decrement(counter, 3)
  yield* PNCounter.increment(counter, 5)

  const value = yield* PNCounter.value(counter)
  console.log("Final value:", value) // 12
})

Effect.runPromise(
  program.pipe(Effect.provide(PNCounter.Live(ReplicaId("replica-1"))))
)
```

### G-Set Example

```typescript
import * as Effect from "effect/Effect"
import * as STM from "effect/STM"
import { GSet, ReplicaId } from "effect-crdts"

const program = Effect.gen(function* () {
  const set = yield* GSet.make<string>(ReplicaId("replica-1"))

  // Add elements to the set
  yield* GSet.add(set, "apple")
  yield* GSet.add(set, "banana")
  yield* GSet.add(set, "apple") // Duplicate, idempotent

  // Check membership
  const hasApple = yield* GSet.has(set, "apple")
  console.log("Has apple:", hasApple) // true

  // Get all values
  const values = yield* GSet.values(set)
  console.log("Values:", Array.from(values)) // ["apple", "banana"]
})

Effect.runPromise(program)
```

## CRDT Laws

All CRDTs in this library satisfy the mathematical properties required for strong eventual consistency:

### Commutativity
```
merge(a, b) = merge(b, a)
```
Order of merging doesn't matter.

### Associativity
```
merge(merge(a, b), c) = merge(a, merge(b, c))
```
Grouping of merges doesn't matter.

### Idempotence
```
merge(a, a) = a
```
Merging the same state multiple times has no effect.

These properties are verified using property-based testing with `fast-check`.

## Architecture

### STM Integration

All CRDT operations return `STM.STM<T>`, making them:
- **Atomic**: Operations either complete fully or not at all
- **Composable**: Can be combined with other STM operations
- **Retryable**: Automatic retry on conflicts
- **Auto-commit**: When yielded in `Effect.gen`, STM operations automatically commit

#### Basic Usage (Auto-commit)

```typescript
// STM operations auto-commit when yielded in Effect.gen
const program = Effect.gen(function* () {
  const counter = yield* GCounter.make(ReplicaId("replica-1"))

  // Each yield auto-commits (3 separate transactions)
  yield* GCounter.increment(counter, 1)
  yield* GCounter.increment(counter, 2)
  yield* GCounter.increment(counter, 3)

  return yield* GCounter.value(counter) // 6
})
```

#### Batched Operations (Single Transaction)

```typescript
// Use dual's curried form for elegant chaining
const program = Effect.gen(function* () {
  const counter = yield* GCounter.make(ReplicaId("replica-1"))

  // All operations in a single transaction using STM.flatMap
  yield* GCounter.increment(counter, 1).pipe(
    STM.flatMap(GCounter.increment(2)),  // Curried! No lambda needed
    STM.flatMap(GCounter.increment(3))
  )

  return yield* GCounter.value(counter) // 6
})
```

#### Composing Multiple CRDTs

```typescript
// Multiple CRDTs in a single atomic transaction
const program = Effect.gen(function* () {
  const counter = yield* GCounter.make(ReplicaId("r1"))
  const set = yield* GSet.make<string>(ReplicaId("r1"))

  // Single atomic transaction
  yield* STM.gen(function* () {
    yield* GCounter.increment(counter, 1)
    yield* GSet.add(set, "item")
    return {
      counterValue: yield* GCounter.value(counter),
      setSize: yield* GSet.size(set)
    }
  })
})
```

### Persistence Abstraction

CRDTs can be persisted to any storage backend by implementing the `CRDTPersistence` interface:

```typescript
interface CRDTPersistence<State> {
  readonly load: (replicaId: ReplicaId) => Effect.Effect<Option.Option<State>, PersistenceError>
  readonly save: (replicaId: ReplicaId, state: State) => Effect.Effect<void, PersistenceError>
  readonly listReplicas: Effect.Effect<ReadonlyArray<ReplicaId>, PersistenceError>
  readonly delete: (replicaId: ReplicaId) => Effect.Effect<void, PersistenceError>
}
```

Built-in implementations:
- **Memory**: Ephemeral in-memory storage
- **Schema-based**: Uses Effect Schema for serialization to key-value stores

Example with persistence:

```typescript
import { GCounter, ReplicaId, layerMemoryPersistence } from "effect-crdts"

const program = Effect.gen(function* () {
  const counter = yield* GCounter.Tag
  yield* STM.commit(GCounter.increment(counter, 42))
})

Effect.runPromise(
  program.pipe(
    Effect.provide(GCounter.Live(ReplicaId("replica-1"))),
    Effect.provide(layerMemoryPersistence())
  )
)
```

### Context Tags for Dependency Injection

Each CRDT is exposed as an Effect Context service:

```typescript
// Using layers
const layer = GCounter.Live(ReplicaId("replica-1"))

// Accessing in Effect programs
const program = Effect.gen(function* () {
  const counter = yield* GCounter.Tag
  // ... use counter
})

Effect.runPromise(program.pipe(Effect.provide(layer)))
```

## Testing

### Run Tests

```bash
npm test
```

### Run with Coverage

```bash
npm run test:coverage
```

### Law Tests

Property-based tests verify CRDT laws for all implementations:

```bash
npm test -- test/laws
```

## Examples

See the `examples/` directory for more comprehensive examples:

- `counter.ts`: Counter CRDT usage patterns
- More examples coming soon!

## Development

```bash
# Install dependencies
npm install

# Build
npm run build

# Run tests
npm test

# Type check
npm run typecheck
```

## Project Structure

```
src/
├── CRDT.ts                 # Core CRDT interfaces and types
├── Persistence.ts          # Persistence abstraction
├── counters/               # Counter CRDTs
│   ├── GCounter.ts
│   └── PNCounter.ts
├── sets/                   # Set CRDTs
│   └── GSet.ts
└── internal/               # Internal utilities

test/
├── laws/                   # CRDT law verification
│   └── CRDTLaws.test.ts
└── counters/               # Unit tests
    └── GCounter.test.ts

examples/                   # Usage examples
```

## Contributing

Contributions are welcome! Please ensure:

1. All tests pass
2. New CRDTs include property-based law tests
3. Code follows Effect patterns and best practices
4. Documentation is updated

## Roadmap

- [ ] Complete remaining CRDT implementations (2P-Set, OR-Set, LWW-Register, LWW-Map, RGA)
- [ ] Causal graph infrastructure for CmRDT support
- [ ] Network synchronization protocols
- [ ] Persistence adapters (IndexedDB, SQLite, etc.)
- [ ] Benchmarks and performance testing
- [ ] Conflict resolution strategies
- [ ] Delta-state synchronization

## License

MIT

## References

- [A comprehensive study of CRDTs](https://hal.inria.fr/hal-01248191v1/document)
- [Conflict-free Replicated Data Types](https://crdt.tech/)
- [Effect Documentation](https://effect.website/)
