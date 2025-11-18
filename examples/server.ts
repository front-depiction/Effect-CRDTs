/**
 * CRDT Sync Server
 *
 * HTTP server that syncs CRDT state across multiple clients.
 * Demonstrates real network synchronization between processes.
 */

import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Schema from "effect/Schema"
import * as HttpServer from "@effect/platform/HttpServer"
import * as HttpRouter from "@effect/platform/HttpRouter"
import * as HttpServerResponse from "@effect/platform/HttpServerResponse"
import * as KeyValueStore from "@effect/platform/KeyValueStore"
import * as FileSystem from "@effect/platform/FileSystem"
import * as Path from "@effect/platform/Path"
import * as BunHttpServer from "@effect/platform-bun/BunHttpServer"
import * as BunFileSystem from "@effect/platform-bun/BunFileSystem"
import * as BunPath from "@effect/platform-bun/BunPath"
import * as BunRuntime from "@effect/platform-bun/BunRuntime"
import * as Console from "effect/Console"
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

// API routes
const router = HttpRouter.empty.pipe(
  // Health check
  HttpRouter.get("/health",
    Effect.succeed(HttpServerResponse.text("OK"))
  ),

  // Get counter state for a replica
  HttpRouter.get("/counter/:replicaId",
    Effect.gen(function* () {
      const params = yield* HttpRouter.params
      const replicaId = ReplicaId(params.replicaId)

      const persistence = yield* Persistence.makeSchemaBasedPersistence(CounterStateSchema)
      const state = yield* persistence.load(replicaId)

      return HttpServerResponse.json({
        replicaId,
        state
      })
    })
  ),

  // Update counter state for a replica
  HttpRouter.post("/counter/:replicaId",
    Effect.gen(function* () {
      const params = yield* HttpRouter.params
      const request = yield* HttpServer.request.HttpServerRequest
      const body = yield* request.json

      const replicaId = ReplicaId(params.replicaId)
      const state = body as CounterState

      const persistence = yield* Persistence.makeSchemaBasedPersistence(CounterStateSchema)
      yield* persistence.save(replicaId, state)

      yield* Console.log(`📥 Received state from ${replicaId}`)

      return HttpServerResponse.json({ success: true })
    })
  ),

  // Sync: merge states from all replicas
  HttpRouter.post("/sync",
    Effect.gen(function* () {
      const request = yield* HttpServer.request.HttpServerRequest
      const body = yield* request.json

      const { replicaId, state } = body as { replicaId: string; state: CounterState }

      yield* Console.log(`🔄 Sync request from ${replicaId}`)

      const persistence = yield* Persistence.makeSchemaBasedPersistence(CounterStateSchema)
      yield* persistence.save(ReplicaId(replicaId), state)

      // TODO: Get all other replica states and return them for merging
      // For now, just acknowledge

      return HttpServerResponse.json({
        success: true,
        message: "State synced"
      })
    })
  )
)

// Server setup
const ServerLive = HttpServer.serve(router).pipe(
  Layer.provide(BunHttpServer.layer({ port: 3000 }))
)

// Main program
const program = Effect.gen(function* () {
  yield* Console.log("🚀 CRDT Sync Server starting...")
  yield* Console.log("📡 Listening on http://localhost:3000")
  yield* Console.log("")
  yield* Console.log("Available endpoints:")
  yield* Console.log("  GET  /health")
  yield* Console.log("  GET  /counter/:replicaId")
  yield* Console.log("  POST /counter/:replicaId")
  yield* Console.log("  POST /sync")
  yield* Console.log("")
  yield* Console.log("💾 Persistence: ./data/server/")
  yield* Console.log("")

  yield* Effect.never
}).pipe(
  Effect.provide(ServerLive),
  Effect.provide(KeyValueStore.layerFileSystem("./data/server")),
  Effect.provide(BunFileSystem.layer),
  Effect.provide(BunPath.layer)
)

BunRuntime.runMain(program)
