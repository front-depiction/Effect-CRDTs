/**
 * G-Set (Grow-only Set) CRDT implementation.
 *
 * A G-Set is a state-based CRDT that implements a set that can only grow by adding
 * elements. Once an element is added, it cannot be removed. Merging is done by
 * taking the union of both sets.
 *
 * Properties:
 * - Add-only (no removes)
 * - Commutative merge operation
 * - Associative merge operation
 * - Idempotent merge operation
 * - Eventually consistent across all replicas
 *
 * @since 0.1.0
 */

import * as Array from "effect/Array"
import * as Context from "effect/Context"
import * as Data from "effect/Data"
import * as Effect from "effect/Effect"
import * as Equal from "effect/Equal"
import * as Hash from "effect/Hash"
import { dual, pipe } from "effect/Function"
import * as Layer from "effect/Layer"
import * as Option from "effect/Option"
import * as STM from "effect/STM"
import * as TRef from "effect/TRef"
import type { Mutable } from "effect/Types"
import { CRDTTypeId, type GrowOnlySet, type GSetState, type ReplicaId } from "./CRDT.js"
import { mergeSets } from "./internal/merge.js"
import { getStateSync, isCRDT, makeEqualImpl, makeProtoBase } from "./internal/proto.js"
import { CRDTPersistenceTag } from "./Persistence.js"

// =============================================================================
// Errors
// =============================================================================

/**
 * Error thrown by G-Set operations.
 *
 * @since 0.1.0
 * @category errors
 */
export class GSetError extends Data.TaggedError("GSetError")<{
  readonly message: string
}> { }

// =============================================================================
// Type Guards
// =============================================================================

/**
 * Type guard to check if a value is a GrowOnlySet.
 *
 * @internal
 */
const isGrowOnlySet = (u: unknown): u is GrowOnlySet<unknown> => isCRDT(u)

// =============================================================================
// Proto Objects
// =============================================================================

/** @internal */
const ProtoGSet = {
  ...makeProtoBase<GSetState<any>>(CRDTTypeId),
  [Equal.symbol]: makeEqualImpl<GrowOnlySet<any>>(isGrowOnlySet),
  [Hash.symbol](this: GrowOnlySet<any>): number {
    const state: GSetState<any> = getStateSync(this.stateRef)
    return pipe(
      Array.fromIterable(state.added),
      Array.map((item) => Hash.hash(item)),
      Array.prepend(Hash.hash(state.replicaId)),
      Array.prepend(Hash.string("GSet")),
      (hashes) => Array.reduce(hashes, 0, (acc, h) => acc ^ h)
    )
  },
  toJSON(this: GrowOnlySet<any>) {
    const state: GSetState<any> = getStateSync(this.stateRef)
    return {
      _id: "GSet",
      replicaId: state.replicaId,
      size: state.added.size
    }
  }
}

// =============================================================================
// Tags
// =============================================================================

/**
 * G-Set service tag factory for dependency injection.
 *
 * Creates a context tag for a G-Set of type A. Use with `Live` or `withPersistence`
 * to create a layer that provides the G-Set instance.
 *
 * @example
 * ```ts
 * import { GSet, Live, ReplicaId } from "effect-crdts/GSet"
 * import * as Effect from "effect/Effect"
 * import * as STM from "effect/STM"
 *
 * const program = Effect.gen(function* () {
 *   const set = yield* GSet<string>()
 *
 *   yield* STM.commit(set.add("apple"))
 *   yield* STM.commit(set.add("banana"))
 *
 *   const hasApple = yield* STM.commit(set.has("apple"))
 *   console.log("Has apple:", hasApple) // true
 *
 *   const values = yield* STM.commit(set.values)
 *   console.log("Values:", Array.from(values)) // ["apple", "banana"]
 * })
 *
 * Effect.runPromise(
 *   program.pipe(Effect.provide(Live<string>(ReplicaId("replica-1"))))
 * )
 * ```
 *
 * @since 0.1.0
 * @category tags
 */
export const GSet = <A>() => Context.GenericTag<GrowOnlySet<A>>("GSet")

// =============================================================================
// Layers
// =============================================================================

/**
 * Creates a live layer with no persistence.
 *
 * State will be held in memory and lost when the process exits.
 *
 * @example
 * ```ts
 * import { GSet, Live, ReplicaId } from "effect-crdts/GSet"
 * import * as Effect from "effect/Effect"
 *
 * const program = Effect.gen(function* () {
 *   const set = yield* GSet<string>()
 *   // ... use set
 * })
 *
 * Effect.runPromise(
 *   program.pipe(Effect.provide(Live<string>(ReplicaId("replica-1"))))
 * )
 * ```
 *
 * @since 0.1.0
 * @category layers
 */
export const Live = <A>(replicaId: ReplicaId) =>
  Layer.effect(
    GSet<A>(),
    Effect.gen(function* () {
      const stateRef = yield* STM.commit(
        TRef.make<GSetState<A>>({
          type: "GSet",
          replicaId,
          added: new Set()
        })
      )

      return makeGSet<A>(replicaId, stateRef)
    })
  )

/**
 * Creates a layer with persistence support.
 *
 * State will be loaded on initialization and saved on finalization.
 * Requires CRDTPersistenceTag<SetState<A>> to be provided.
 *
 * @example
 * ```ts
 * import { GSet, withPersistence, ReplicaId, layerMemoryPersistence } from "effect-crdts/GSet"
 * import * as Effect from "effect/Effect"
 *
 * const program = Effect.gen(function* () {
 *   const set = yield* GSet<string>()
 *   // ... use set - state will be persisted
 * }).pipe(
 *   Effect.provide(withPersistence<string>(ReplicaId("replica-1"))),
 *   Effect.provide(layerMemoryPersistence<SetState<string>>())
 * )
 * ```
 *
 * @since 0.1.0
 * @category layers
 */
export const withPersistence = <A>(replicaId: ReplicaId) =>
  Layer.scoped(
    GSet<A>(),
    Effect.gen(function* () {
      const persistence = yield* CRDTPersistenceTag<GSetState<A>>()
      const loadedState: Option.Option<GSetState<A>> = yield* persistence.load(replicaId)

      const initialState: GSetState<A> = pipe(
        loadedState,
        Option.getOrElse(() => ({
          type: "GSet" as const,
          replicaId,
          added: new Set<A>()
        }))
      )

      const stateRef = yield* STM.commit(TRef.make(initialState))
      const set = makeGSet<A>(replicaId, stateRef)

      // Setup auto-save on finalization
      yield* Effect.addFinalizer(() =>
        pipe(
          STM.commit(TRef.get(stateRef)),
          Effect.flatMap((state) => persistence.save(replicaId, state)),
          Effect.ignoreLogged
        )
      )

      return set
    })
  )

// =============================================================================
// Constructors
// =============================================================================

/**
 * Internal constructor for G-Set.
 *
 * @internal
 */
const makeGSet = <A>(replicaId: ReplicaId, stateRef: TRef.TRef<GSetState<A>>): GrowOnlySet<A> => {
  const set: Mutable<GrowOnlySet<A>> = Object.create(ProtoGSet)
  set.stateRef = stateRef
  set.replicaId = replicaId

  set.query = TRef.get(stateRef)

  set.merge = (other) =>
    TRef.update(stateRef, (current) => ({
      ...current,
      added: mergeSets(current.added, other.added)
    }))

  set.delta = pipe(
    TRef.get(stateRef),
    STM.map((state) => Option.some(state))
  )

  set.applyDelta = (delta) =>
    TRef.update(stateRef, (current) => ({
      ...current,
      added: mergeSets(current.added, delta.added)
    }))

  set.add = (value) =>
    TRef.update(stateRef, (state) => {
      const newAdded = new Set(state.added)
      newAdded.add(value)
      return {
        ...state,
        added: newAdded
      }
    })

  set.has = (value) =>
    pipe(
      TRef.get(stateRef),
      STM.map((state) => state.added.has(value))
    )

  set.values = pipe(
    TRef.get(stateRef),
    STM.map((state) => state.added)
  )

  set.size = pipe(
    TRef.get(stateRef),
    STM.map((state) => state.added.size)
  )

  return set
}

/**
 * Creates a new G-Set with the given replica ID.
 *
 * @example
 * ```ts
 * import { make, ReplicaId } from "effect-crdts/GSet"
 * import * as Effect from "effect/Effect"
 * import * as STM from "effect/STM"
 *
 * const program = Effect.gen(function* () {
 *   const set = yield* make<string>(ReplicaId("replica-1"))
 *
 *   yield* STM.commit(set.add("item1"))
 *   yield* STM.commit(set.add("item2"))
 *
 *   const values = yield* STM.commit(set.values)
 *   console.log("Values:", Array.from(values))
 * })
 * ```
 *
 * @since 0.1.0
 * @category constructors
 */
export const make = <A>(replicaId: ReplicaId): Effect.Effect<GrowOnlySet<A>> =>
  Effect.gen(function* () {
    const stateRef = yield* STM.commit(
      TRef.make<GSetState<A>>({
        type: "GSet",
        replicaId,
        added: new Set()
      })
    )
    return makeGSet<A>(replicaId, stateRef)
  })

/**
 * Add an element to a set.
 *
 * @example
 * ```ts
 * import { GSet, add } from "effect-crdts/GSet"
 * import * as Effect from "effect/Effect"
 * import * as STM from "effect/STM"
 *
 * const program = Effect.gen(function* () {
 *   const set = yield* GSet<string>()
 *   yield* STM.commit(add(set, "apple"))
 * })
 * ```
 *
 * @since 0.1.0
 * @category operations
 */
export const add: {
  <A>(value: A): (set: GrowOnlySet<A>) => STM.STM<void>
  <A>(set: GrowOnlySet<A>, value: A): STM.STM<void>
} = dual(2, <A>(set: GrowOnlySet<A>, value: A): STM.STM<void> => set.add(value))

/**
 * Check if a set contains an element.
 *
 * @example
 * ```ts
 * import { GSet, has } from "effect-crdts/GSet"
 * import * as Effect from "effect/Effect"
 * import * as STM from "effect/STM"
 *
 * const program = Effect.gen(function* () {
 *   const set = yield* GSet<string>()
 *   const exists = yield* STM.commit(has(set, "apple"))
 *   console.log("Has apple:", exists)
 * })
 * ```
 *
 * @since 0.1.0
 * @category getters
 */
export const has: {
  <A>(value: A): (set: GrowOnlySet<A>) => STM.STM<boolean>
  <A>(set: GrowOnlySet<A>, value: A): STM.STM<boolean>
} = dual(2, <A>(set: GrowOnlySet<A>, value: A): STM.STM<boolean> => set.has(value))

/**
 * Get all values in a set.
 *
 * @example
 * ```ts
 * import { GSet, values } from "effect-crdts/GSet"
 * import * as Effect from "effect/Effect"
 * import * as STM from "effect/STM"
 *
 * const program = Effect.gen(function* () {
 *   const set = yield* GSet<string>()
 *   const vals = yield* STM.commit(values(set))
 *   console.log("Values:", Array.from(vals))
 * })
 * ```
 *
 * @since 0.1.0
 * @category getters
 */
export const values = <A>(set: GrowOnlySet<A>): STM.STM<ReadonlySet<A>> => set.values

/**
 * Get the size of a set.
 *
 * @since 0.1.0
 * @category getters
 */
export const size = <A>(set: GrowOnlySet<A>): STM.STM<number> => set.size

/**
 * Merge another set's state into this set.
 *
 * @example
 * ```ts
 * import { make, merge, add, values, ReplicaId } from "effect-crdts/GSet"
 * import * as Effect from "effect/Effect"
 * import * as STM from "effect/STM"
 *
 * const program = Effect.gen(function* () {
 *   const set1 = yield* make<string>(ReplicaId("replica-1"))
 *   const set2 = yield* make<string>(ReplicaId("replica-2"))
 *
 *   yield* STM.commit(add(set1, "apple"))
 *   yield* STM.commit(add(set2, "banana"))
 *
 *   const state2 = yield* STM.commit(set2.query)
 *   yield* STM.commit(merge(set1, state2))
 *
 *   const vals = yield* STM.commit(values(set1))
 *   console.log("Merged values:", Array.from(vals)) // ["apple", "banana"]
 * })
 * ```
 *
 * @since 0.1.0
 * @category operations
 */
export const merge: {
  <A>(other: GSetState<A>): (set: GrowOnlySet<A>) => STM.STM<void>
  <A>(set: GrowOnlySet<A>, other: GSetState<A>): STM.STM<void>
} = dual(2, <A>(set: GrowOnlySet<A>, other: GSetState<A>): STM.STM<void> => set.merge(other))

/**
 * Get the current state of a set.
 *
 * @since 0.1.0
 * @category getters
 */
export const query = <A>(set: GrowOnlySet<A>): STM.STM<GSetState<A>> => set.query
