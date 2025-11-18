/**
 * CRDT Client
 *
 * Connects to sync server and demonstrates real persistence across processes.
 * Run multiple instances to see CRDTs sync across different processes.
 */

import * as Effect from "effect/Effect"
import * as Schedule from "effect/Schedule"
import * as Duration from "effect/Duration"
import * as Console from "effect/Console"
import * as STM from "effect/STM"
import * as Random from "effect/Random"
import * as Layer from "effect/Layer"
import * as Schema from "effect/Schema"
import * as KeyValueStore from "@effect/platform/KeyValueStore"
import * as Path from "@effect/platform/Path"
import * as FileSystem from "@effect/platform/FileSystem"
import * as BunFileSystem from "@effect/platform-bun/BunFileSystem"
import * as BunPath from "@effect/platform-bun/BunPath"
import * as BunRuntime from "@effect/platform-bun/BunRuntime"
import * as PNCounter from "../src/PNCounter.js"
import * as Persistence from "../src/Persistence.js"
import { ReplicaId, type CounterState } from "../src/CRDT.js"

// Schema for CounterState
const CounterStateSchema = Schema.Struct({
  type: Schema.Literal("PNCounter"),
  replicaId: Schema.String,
  counts: Schema.Map({
    key: Schema.String,
    value: Schema.Number
  }),
  decrements: Schema.optional(Schema.Map({
    key: Schema.String,
    value: Schema.Number
  }))
})

// Get config from command line args
const getConfig = () => {
  const args = process.argv.slice(2)
  const replicaName = args[0] || "replica-1"
  const dataDir = args[1] || `./data/${replicaName}`

  return { replicaName, dataDir }
}

// Simulate activity
const simulateActivity = (counter: PNCounter.Counter, replicaName: string) =>
  Effect.gen(function* () {
    const value = yield* Random.nextIntBetween(1, 10)
    const isIncrement = yield* Random.nextBoolean

    if (isIncrement) {
      yield* STM.commit(counter.increment(value))
      yield* Console.log(`  📈 +${value}`)
    } else {
      yield* STM.commit(counter.decrement(value))
      yield* Console.log(`  📉 -${value}`)
    }

    const currentValue = yield* STM.commit(counter.value)
    yield* Console.log(`  💰 Current value: ${currentValue}`)
  })

// Main program
const program = Effect.gen(function* () {
  const { replicaName, dataDir } = getConfig()

  yield* Console.log("")
  yield* Console.log("=".repeat(60))
  yield* Console.log(`🚀 Starting CRDT Client: ${replicaName}`)
  yield* Console.log("=".repeat(60))
  yield* Console.log(`💾 Data directory: ${dataDir}`)
  yield* Console.log(`🆔 Replica ID: ${replicaName}`)
  yield* Console.log("")

  // Yield the counter from the service
  const counter = yield* PNCounter.PNCounter

  // Check if we have existing state
  const initialValue = yield* STM.commit(counter.value)
  yield* Console.log(`✅ Counter loaded: ${initialValue}`)
  yield* Console.log("")

  // Run activity loop
  yield* Console.log("🎯 Starting activity (press Ctrl+C to stop)...")
  yield* Console.log("")

  let round = 1
  yield* Effect.repeat(
    Effect.gen(function* () {
      yield* Console.log(`📍 Round ${round}:`)
      yield* simulateActivity(counter, replicaName)
      yield* Console.log("")
      round++
    }),
    Schedule.spaced(Duration.seconds(3))
  )
})

// Run with all layers provided
const { replicaName, dataDir } = getConfig()

const runnable = program.pipe(
  Effect.provide(PNCounter.PNCounter.withPersistence(ReplicaId(replicaName))),
  Effect.provide(Persistence.withSchemaLayer(CounterStateSchema)),
  Effect.provide(KeyValueStore.layerFileSystem(dataDir)),
  Effect.provide(BunFileSystem.layer),
  Effect.provide(BunPath.layer),
  Effect.catchAll((error) =>
    Console.log(`❌ Error: ${error}`)
  )
)

BunRuntime.runMain(runnable)
