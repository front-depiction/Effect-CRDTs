/**
 * Example: Basic counter usage with G-Counter and PN-Counter.
 *
 * This example demonstrates how to use counter CRDTs for distributed counting.
 *
 * @since 0.1.0
 */

import * as Effect from "effect/Effect"
import * as STM from "effect/STM"
import { GCounter, PNCounter, ReplicaId } from "../src/index.js"

// Example 1: Simple G-Counter usage
const simpleGCounter = Effect.gen(function* () {
  console.log("=== Simple G-Counter Example ===")

  const counter = yield* GCounter.GCounter

  yield* STM.commit(counter.increment(5))
  yield* STM.commit(counter.increment(3))

  const value = yield* STM.commit(counter.value)
  console.log("Counter value:", value) // 8
})

// Example 2: Multi-replica G-Counter with synchronization
const multiReplicaGCounter = Effect.gen(function* () {
  console.log("\n=== Multi-Replica G-Counter Example ===")

  // Create two replicas
  const replica1 = yield* GCounter.make(ReplicaId("replica-1"))
  const replica2 = yield* GCounter.make(ReplicaId("replica-2"))

  // Each replica increments independently
  console.log("Replica 1 increments by 10")
  yield* STM.commit(replica1.increment(10))

  console.log("Replica 2 increments by 20")
  yield* STM.commit(replica2.increment(20))

  // Before sync
  const value1Before = yield* STM.commit(replica1.value)
  const value2Before = yield* STM.commit(replica2.value)
  console.log("Before sync - Replica 1:", value1Before, "Replica 2:", value2Before)

  // Synchronize replicas
  const state2 = yield* STM.commit(replica2.query)
  yield* STM.commit(replica1.merge(state2))

  const state1 = yield* STM.commit(replica1.query)
  yield* STM.commit(replica2.merge(state1))

  // After sync - both should have same value
  const value1After = yield* STM.commit(replica1.value)
  const value2After = yield* STM.commit(replica2.value)
  console.log("After sync - Replica 1:", value1After, "Replica 2:", value2After)
})

// Example 3: PN-Counter with increments and decrements
const pnCounterExample = Effect.gen(function* () {
  console.log("\n=== PN-Counter Example ===")

  const counter = yield* PNCounter.PNCounter

  console.log("Incrementing by 10")
  yield* STM.commit(counter.increment(10))

  console.log("Decrementing by 3")
  yield* STM.commit(counter.decrement(3))

  console.log("Incrementing by 5")
  yield* STM.commit(counter.increment(5))

  const value = yield* STM.commit(counter.value)
  console.log("Final value:", value) // 12
})

// Example 4: Multi-replica PN-Counter
const multiReplicaPNCounter = Effect.gen(function* () {
  console.log("\n=== Multi-Replica PN-Counter Example ===")

  const replica1 = yield* PNCounter.make(ReplicaId("replica-1"))
  const replica2 = yield* PNCounter.make(ReplicaId("replica-2"))

  // Replica 1: +10, -3 = 7
  yield* STM.commit(replica1.increment(10))
  yield* STM.commit(replica1.decrement(3))

  // Replica 2: +20, -5 = 15
  yield* STM.commit(replica2.increment(20))
  yield* STM.commit(replica2.decrement(5))

  console.log("Replica 1 value:", yield* STM.commit(replica1.value))
  console.log("Replica 2 value:", yield* STM.commit(replica2.value))

  // Merge replicas
  const state2 = yield* STM.commit(replica2.query)
  yield* STM.commit(replica1.merge(state2))

  const mergedValue = yield* STM.commit(replica1.value)
  console.log("Merged value:", mergedValue) // 22
})

// Run all examples
const program = Effect.gen(function* () {
  yield* simpleGCounter.pipe(Effect.provide(GCounter.GCounter.Live(ReplicaId("simple-replica"))))

  yield* multiReplicaGCounter

  yield* pnCounterExample.pipe(Effect.provide(PNCounter.PNCounter.Live(ReplicaId("pn-replica"))))

  yield* multiReplicaPNCounter
})

Effect.runPromise(program).catch(console.error)
