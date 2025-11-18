/**
 * CRDT Sync Utility
 *
 * Manually syncs CRDTs between different data directories.
 * Run this to see CRDTs merge across processes.
 */

import * as Effect from "effect/Effect"
import * as Console from "effect/Console"
import * as STM from "effect/STM"
import * as Layer from "effect/Layer"
import * as Schema from "effect/Schema"
import * as KeyValueStore from "@effect/platform/KeyValueStore"
import * as FileSystem from "@effect/platform/FileSystem"
import * as Path from "@effect/platform/Path"
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

// Load counter from directory
const loadCounter = (replicaName: string, dataDir: string) =>
  Effect.gen(function* () {
    const counter = yield* PNCounter.PNCounter
    const value = yield* STM.commit(counter.value)
    const state = yield* STM.commit(counter.query)

    return { counter, value, state }
  }).pipe(
    Effect.provide(PNCounter.PNCounter.withPersistence(ReplicaId(replicaName))),
    Effect.provide(Persistence.withSchemaLayer(CounterStateSchema)),
    Effect.provide(KeyValueStore.layerFileSystem(dataDir)),
    Effect.provide(BunFileSystem.layer),
    Effect.provide(BunPath.layer)
  )

// Main sync program
const program = Effect.gen(function* () {
  yield* Console.log("")
  yield* Console.log("🔄 CRDT Sync Utility")
  yield* Console.log("=" .repeat(60))
  yield* Console.log("")

  // Get replicas to sync
  const replicas = [
    { name: "replica-1", dir: "./data/replica-1" },
    { name: "replica-2", dir: "./data/replica-2" },
    { name: "replica-3", dir: "./data/replica-3" }
  ]

  yield* Console.log("📊 Loading replicas...")
  yield* Console.log("")

  // Load all replicas
  const loaded = yield* Effect.forEach(replicas, ({ name, dir }) =>
    Effect.gen(function* () {
      const result = yield* loadCounter(name, dir)
      yield* Console.log(`  ${name.padEnd(12)} = ${result.value}`)
      return { name, dir, ...result }
    })
  )

  yield* Console.log("")
  yield* Console.log("🔀 Merging states...")
  yield* Console.log("")

  // Merge all states into each replica
  for (const replica of loaded) {
    for (const other of loaded) {
      if (replica.name !== other.name) {
        yield* STM.commit(replica.counter.merge(other.state))
      }
    }
  }

  // Show final values
  yield* Console.log("✅ Sync complete! Final values:")
  yield* Console.log("")

  for (const replica of loaded) {
    const finalValue = yield* STM.commit(replica.counter.value)
    yield* Console.log(`  ${replica.name.padEnd(12)} = ${finalValue}`)
  }

  yield* Console.log("")
  yield* Console.log("💾 Changes saved to disk")
  yield* Console.log("")
})

BunRuntime.runMain(program)
