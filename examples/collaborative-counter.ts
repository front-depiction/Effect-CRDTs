/**
 * Collaborative Counter Demo
 *
 * This demo simulates a distributed like/view counter system where multiple
 * replicas (servers/clients) can increment counters independently and sync
 * their state periodically.
 *
 * Real-world use case: Analytics dashboard with multiple data collection points
 * that need to aggregate counts without coordination.
 */

import * as Effect from "effect/Effect"
import * as Schedule from "effect/Schedule"
import * as STM from "effect/STM"
import * as Console from "effect/Console"
import * as Duration from "effect/Duration"
import * as Fiber from "effect/Fiber"
import * as Random from "effect/Random"
import * as PNCounter from "../src/PNCounter.js"
import * as CRDT from "../src/CRDT.js"

// Simulates a network sync between replicas
const syncReplicas = (
  replica1: CRDT.Counter,
  replica2: CRDT.Counter,
  name1: string,
  name2: string
) =>
  Effect.gen(function* () {
    // Get state from both replicas
    const state1 = yield* STM.commit(replica1.query)
    const state2 = yield* STM.commit(replica2.query)

    // Merge states (simulating network sync)
    yield* STM.commit(replica1.merge(state2))
    yield* STM.commit(replica2.merge(state1))

    yield* Console.log(`🔄 Synced ${name1} ↔ ${name2}`)
  })

// Simulates user activity on a replica
const simulateActivity = (
  replica: CRDT.Counter,
  replicaName: string,
  color: string
) =>
  Effect.gen(function* () {
    // Use Random module

    // Random increment/decrement
    const value = yield* Random.nextIntBetween(1, 5)
    const isIncrement = yield* Random.nextBoolean

    if (isIncrement) {
      yield* STM.commit(replica.increment(value))
      yield* Console.log(`${color}📈 ${replicaName}: +${value}`)
    } else {
      yield* STM.commit(replica.decrement(value))
      yield* Console.log(`${color}📉 ${replicaName}: -${value}`)
    }
  })

// Main demo program
const program = Effect.gen(function* () {
  yield* Console.log("🚀 Starting Collaborative Counter Demo")
  yield* Console.log("=".repeat(50))
  yield* Console.log("")

  // Create three replicas (simulating different servers/regions)
  const replica1 = yield* PNCounter.make(CRDT.ReplicaId("us-east"))
  const replica2 = yield* PNCounter.make(CRDT.ReplicaId("eu-west"))
  const replica3 = yield* PNCounter.make(CRDT.ReplicaId("asia-pacific"))

  yield* Console.log("✅ Created 3 replicas: us-east, eu-west, asia-pacific")
  yield* Console.log("")

  // Set initial values
  yield* STM.commit(replica1.increment(100))
  yield* STM.commit(replica2.increment(100))
  yield* STM.commit(replica3.increment(100))

  yield* Console.log("🎯 Initial state: Each replica starts with 100")
  yield* Console.log("")

  // Simulate 10 rounds of activity
  for (let round = 1; round <= 10; round++) {
    yield* Console.log(`\n📍 Round ${round}:`)

    // Simulate random activity on each replica
    yield* simulateActivity(replica1, "US-EAST", "\x1b[36m")
    yield* simulateActivity(replica2, "EU-WEST", "\x1b[33m")
    yield* simulateActivity(replica3, "ASIA-PAC", "\x1b[35m")

    // Show values before sync
    const val1 = yield* STM.commit(replica1.value)
    const val2 = yield* STM.commit(replica2.value)
    const val3 = yield* STM.commit(replica3.value)

    yield* Console.log(`\x1b[0m  Before sync: US=${val1}, EU=${val2}, ASIA=${val3}`)

    // Sync replicas (simulating periodic network sync)
    if (round % 3 === 0) {
      yield* syncReplicas(replica1, replica2, "US-EAST", "EU-WEST")
      yield* syncReplicas(replica2, replica3, "EU-WEST", "ASIA-PAC")
      yield* syncReplicas(replica1, replica3, "US-EAST", "ASIA-PAC")

      // Show values after sync
      const syncedVal1 = yield* STM.commit(replica1.value)
      const syncedVal2 = yield* STM.commit(replica2.value)
      const syncedVal3 = yield* STM.commit(replica3.value)

      yield* Console.log(`  After sync:  US=${syncedVal1}, EU=${syncedVal2}, ASIA=${syncedVal3}`)
      yield* Console.log("  ✨ All replicas converged!")
    }
  }

  // Final sync to ensure convergence
  yield* Console.log("\n🔄 Final synchronization...")
  yield* syncReplicas(replica1, replica2, "US-EAST", "EU-WEST")
  yield* syncReplicas(replica2, replica3, "EU-WEST", "ASIA-PAC")
  yield* syncReplicas(replica1, replica3, "US-EAST", "ASIA-PAC")

  // Show final state
  const finalVal1 = yield* STM.commit(replica1.value)
  const finalVal2 = yield* STM.commit(replica2.value)
  const finalVal3 = yield* STM.commit(replica3.value)

  yield* Console.log("")
  yield* Console.log("=".repeat(50))
  yield* Console.log("🎉 Final State (All Replicas Converged):")
  yield* Console.log(`   US-EAST:      ${finalVal1}`)
  yield* Console.log(`   EU-WEST:      ${finalVal2}`)
  yield* Console.log(`   ASIA-PACIFIC: ${finalVal3}`)
  yield* Console.log("=".repeat(50))
  yield* Console.log("")
  yield* Console.log(finalVal1 === finalVal2 && finalVal2 === finalVal3 ? "✅ Demo complete! All replicas have the same value." : "❌ Demo failed! Replicas diverged.")
  yield* Console.log("💡 This demonstrates eventual consistency without coordination!")
})

// Run the demo
Effect.runPromise(program)
