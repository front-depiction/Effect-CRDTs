/**
 * Persistence abstraction for CRDT state.
 *
 * This module provides a pluggable persistence layer that allows CRDTs to be
 * saved and loaded from various storage backends (memory, file system, database, etc.).
 *
 * @since 0.1.0
 */

import * as KeyValueStore from "@effect/platform/KeyValueStore"
import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Option from "effect/Option"
import * as Schema from "effect/Schema"
import type { ReplicaId } from "./CRDT.js"

/**
 * Generic persistence interface for CRDT state.
 *
 * Implementations of this interface provide the storage backend for CRDTs,
 * allowing state to be persisted and recovered across process restarts.
 *
 * @since 0.1.0
 * @category models
 */
export interface CRDTPersistence<State, E = never, R = never> {
  /**
   * Load state from the persistence layer.
   *
   * Returns None if no state exists for the given replica.
   *
   * @since 0.1.0
   */
  readonly load: (replicaId: ReplicaId) => Effect.Effect<Option.Option<State>, E, R>

  /**
   * Save state to the persistence layer.
   *
   * @since 0.1.0
   */
  readonly save: (replicaId: ReplicaId, state: State) => Effect.Effect<void, E, R>

  /**
   * Delete persisted state for a replica.
   *
   * @since 0.1.0
   */
  readonly delete: (replicaId: ReplicaId) => Effect.Effect<void, E, R>
}

/**
 * Creates a context tag for CRDT persistence service.
 *
 * @since 0.1.0
 * @category tags
 */
export const CRDTPersistenceTag = <State>() =>
  Context.GenericTag<CRDTPersistence<State>>("CRDTPersistence")

/**
 * Layer for in-memory persistence.
 *
 * @example
 * ```ts
 * import { layerMemoryPersistence } from "effect-crdts/Persistence"
 * import { PNCounter } from "effect-crdts/PNCounter"
 * import * as Effect from "effect/Effect"
 *
 * const program = Effect.gen(function* () {
 *   const counter = yield* PNCounter.PNCounter
 *   // ... use counter
 * }).pipe(
 *   Effect.provide(PNCounter.PNCounter.withPersistence(ReplicaId("replica-1"))),
 *   Effect.provide(layerMemoryPersistence())
 * )
 * ```
 *
 * @since 0.1.0
 * @category layers
 */
export const layerMemoryPersistence = <State>() =>
  Layer.succeed(CRDTPersistenceTag<State>(), {
    load: (replicaId) =>
      Effect.sync(() => {
        const storage = new Map<ReplicaId, State>()
        const state = storage.get(replicaId)
        return state === undefined ? Option.none() : Option.some(state)
      }),

    save: (replicaId, state) =>
      Effect.sync(() => {
        const storage = new Map<ReplicaId, State>()
        storage.set(replicaId, state)
      }),

    delete: (replicaId) =>
      Effect.sync(() => {
        const storage = new Map<ReplicaId, State>()
        storage.delete(replicaId)
      })
  })

/**
 * Layer for schema-based persistence with automatic encoding/decoding.
 *
 * Compose with KeyValueStore layers for different backends.
 *
 * @example
 * ```ts
 * import { withSchemaLayer } from "effect-crdts/Persistence"
 * import { PNCounter } from "effect-crdts/PNCounter"
 * import * as Schema from "effect/Schema"
 * import * as Effect from "effect/Effect"
 * import * as KeyValueStore from "@effect/platform/KeyValueStore"
 * import * as BunFileSystem from "@effect/platform-bun/BunFileSystem"
 * import * as BunPath from "@effect/platform-bun/BunPath"
 *
 * const CounterStateSchema = Schema.Struct({
 *   type: Schema.Literal("PNCounter"),
 *   replicaId: Schema.String,
 *   counts: Schema.Map({ key: Schema.String, value: Schema.Number }),
 *   decrements: Schema.optional(Schema.Map({ key: Schema.String, value: Schema.Number }))
 * })
 *
 * const program = Effect.gen(function* () {
 *   const counter = yield* PNCounter.PNCounter
 *   // ... use counter
 * }).pipe(
 *   Effect.provide(PNCounter.PNCounter.withPersistence(ReplicaId("replica-1"))),
 *   Effect.provide(withSchemaLayer(CounterStateSchema)),
 *   Effect.provide(KeyValueStore.layerFileSystem("./data")),
 *   Effect.provide(BunFileSystem.layer),
 *   Effect.provide(BunPath.layer)
 * )
 * ```
 *
 * @since 0.1.0
 * @category layers
 */
export const withSchemaLayer = <A, I, R>(schema: Schema.Schema<A, I, R>) =>
  Layer.effect(
    CRDTPersistenceTag<A>(),
    Effect.gen(function* () {
      const store = yield* KeyValueStore.KeyValueStore
      const schemaStore = store.forSchema(schema)

      return {
        load: (replicaId) => schemaStore.get(replicaId),

        save: (replicaId, state) => schemaStore.set(replicaId, state),

        delete: (replicaId) => schemaStore.remove(replicaId)
      } as CRDTPersistence<A>
    })
  )

/**
 * Re-export Platform's KeyValueStore for convenience.
 *
 * @since 0.1.0
 * @category re-exports
 */
export { KeyValueStore } from "@effect/platform/KeyValueStore"
