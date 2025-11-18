/**
 * G-Counter (Grow-only Counter) CRDT implementation.
 *
 * A G-Counter is a state-based CRDT that implements a counter that can only be
 * incremented. Each replica maintains its own count, and the global value is the
 * sum of all replica counts. Merging is done by taking the maximum count for each
 * replica.
 *
 * Properties:
 * - Increment-only (no decrements)
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
import * as Number from "effect/Number"
import * as Option from "effect/Option"
import * as Schema from "effect/Schema"
import * as STM from "effect/STM"
import * as TRef from "effect/TRef"
import type { Mutable } from "effect/Types"
import { CRDTTypeId, type Counter, type CounterState, type ReplicaId } from "./CRDT.js"
import { mergeMaps } from "./internal/merge.js"
import { getStateSync, isCRDT, makeEqualImpl, makeProtoBase } from "./internal/proto.js"
import * as Persistence from "./Persistence.js"

// =============================================================================
// Errors
// =============================================================================

/**
 * Error thrown by G-Counter operations.
 *
 * @since 0.1.0
 * @category errors
 */
export class GCounterError extends Data.TaggedError("GCounterError")<{
  readonly message: string
}> {}

// =============================================================================
// Schema
// =============================================================================

/**
 * Schema for CounterState used in persistence.
 *
 * @internal
 */
const CounterStateSchema: Schema.Schema<CounterState, CounterState, never> = Schema.Struct({
  type: Schema.Literal("GCounter", "PNCounter"),
  replicaId: Schema.String as unknown as Schema.Schema<ReplicaId, ReplicaId, never>,
  counts: Schema.ReadonlyMap({ key: Schema.String as unknown as Schema.Schema<ReplicaId, ReplicaId, never>, value: Schema.Number }),
  decrements: Schema.optional(Schema.ReadonlyMap({ key: Schema.String as unknown as Schema.Schema<ReplicaId, ReplicaId, never>, value: Schema.Number }))
}) as any

// =============================================================================
// Type Guards
// =============================================================================

/**
 * Type guard to check if a value is a Counter.
 *
 * @internal
 */
const isCounter = (u: unknown): u is Counter => isCRDT(u)

// =============================================================================
// Proto Objects
// =============================================================================

/** @internal */
const ProtoGCounter = {
  ...makeProtoBase<CounterState>(CRDTTypeId),
  [Equal.symbol]: makeEqualImpl<Counter>(isCounter),
  [Hash.symbol](this: Counter): number {
    const state: CounterState = getStateSync(this.stateRef)
    return pipe(
      Array.fromIterable(state.counts.entries()),
      Array.map(([replicaId, count]) => Hash.hash(replicaId) + Hash.number(count)),
      Array.prepend(Hash.hash(state.replicaId)),
      Array.prepend(Hash.string("GCounter")),
      (hashes) => Array.reduce(hashes, 0, (acc, h) => acc ^ h)
    )
  },
  toJSON(this: Counter) {
    const state: CounterState = getStateSync(this.stateRef)
    return {
      _id: "GCounter",
      replicaId: state.replicaId,
      value: this.value.pipe(STM.commit, Effect.runSync)
    }
  }
}

// =============================================================================
// Constructors
// =============================================================================

/**
 * G-Counter service tag for dependency injection.
 *
 * @example
 * ```ts
 * import { GCounter, ReplicaId } from "effect-crdts"
 * import * as Effect from "effect/Effect"
 * import * as STM from "effect/STM"
 *
 * const program = Effect.gen(function* () {
 *   const counter = yield* GCounter
 *
 *   yield* STM.commit(counter.increment(5))
 *   yield* STM.commit(counter.increment(3))
 *
 *   const value = yield* STM.commit(counter.value)
 *   console.log("Counter value:", value) // 8
 * })
 *
 * Effect.runPromise(
 *   program.pipe(Effect.provide(GCounter.Live(ReplicaId("replica-1"))))
 * )
 * ```
 *
 * @since 0.1.0
 * @category tags
 */
export class GCounter extends Context.Tag("GCounter")<GCounter, Counter>() {
  /**
   * Creates a live layer with no persistence.
   *
   * State will be held in memory and lost when the process exits.
   *
   * @since 0.1.0
   */
  static Live = (replicaId: ReplicaId): Layer.Layer<GCounter> =>
    Layer.effect(
      this,
      Effect.gen(function* () {
        const stateRef = yield* STM.commit(
          TRef.make<CounterState>({
            type: "GCounter",
            replicaId,
            counts: new Map([[replicaId, 0]])
          })
        )

        return makeGCounter(replicaId, stateRef)
      })
    )

  /**
   * Creates a layer with persistence support.
   *
   * State will be loaded on initialization and can be saved.
   * Requires CRDTPersistence to be provided.
   *
   * @since 0.1.0
   */
  static withPersistence = (replicaId: ReplicaId) =>
    Layer.scoped(
      this,
      Effect.gen(function* () {
        const basePersistence = yield* Persistence.CRDTPersistence
        const persistence = basePersistence.forSchema(CounterStateSchema)
        const loadedState: Option.Option<CounterState> = yield* persistence.load(replicaId)

        const initialState: CounterState = pipe(
          loadedState,
          Option.getOrElse(() => ({
            type: "GCounter" as const,
            replicaId,
            counts: new Map([[replicaId, 0]])
          }))
        )

        const stateRef = yield* STM.commit(TRef.make(initialState))
        const counter = makeGCounter(replicaId, stateRef)

        // Setup auto-save on finalization
        yield* Effect.addFinalizer(() =>
          pipe(
            STM.commit(TRef.get(stateRef)),
            Effect.flatMap((state) => persistence.save(replicaId, state)),
            Effect.ignoreLogged
          )
        )

        return counter
      })
    )
}

/**
 * Internal constructor for G-Counter.
 *
 * @internal
 */
const makeGCounter = (replicaId: ReplicaId, stateRef: TRef.TRef<CounterState>): Counter => {
  const counter: Mutable<Counter> = Object.create(ProtoGCounter)
  counter.stateRef = stateRef
  counter.replicaId = replicaId

  counter.query = TRef.get(stateRef)

  counter.merge = (other) =>
    TRef.update(stateRef, (current) => ({
      ...current,
      counts: mergeMaps(current.counts, other.counts, Number.max)
    }))

  counter.delta = pipe(
    TRef.get(stateRef),
    STM.map((state) => Option.some(state))
  )

  counter.applyDelta = (delta) =>
    TRef.update(stateRef, (current) => ({
      ...current,
      counts: mergeMaps(current.counts, delta.counts, Number.max)
    }))

  counter.increment = (value = 1) => {
    if (value < 0) {
      return STM.die(new GCounterError({ message: "Cannot increment by negative value" }))
    }
    return TRef.update(stateRef, (state) => {
      const currentCount = state.counts.get(replicaId) ?? 0
      const newCounts = new Map(state.counts)
      newCounts.set(replicaId, currentCount + value)
      return {
        ...state,
        counts: newCounts
      }
    })
  }

  counter.decrement = () => STM.die(new GCounterError({ message: "GCounter does not support decrement" }))

  counter.value = pipe(
    TRef.get(stateRef),
    STM.map((state) => Number.sumAll(state.counts.values()))
  )

  return counter
}

/**
 * Creates a new G-Counter with the given replica ID.
 *
 * @example
 * ```ts
 * import { make, ReplicaId } from "effect-crdts/GCounter"
 * import * as Effect from "effect/Effect"
 * import * as STM from "effect/STM"
 *
 * const program = Effect.gen(function* () {
 *   const counter = yield* make(ReplicaId("replica-1"))
 *
 *   yield* STM.commit(counter.increment(10))
 *   const value = yield* STM.commit(counter.value)
 *
 *   console.log("Value:", value) // 10
 * })
 * ```
 *
 * @since 0.1.0
 * @category constructors
 */
export const make = (replicaId: ReplicaId): Effect.Effect<Counter> =>
  Effect.gen(function* () {
    const stateRef = yield* STM.commit(
      TRef.make<CounterState>({
        type: "GCounter",
        replicaId,
        counts: new Map([[replicaId, 0]])
      })
    )
    return makeGCounter(replicaId, stateRef)
  })

// =============================================================================
// Operations
// =============================================================================

/**
 * Increment a counter by a value (default: 1).
 *
 * @example
 * ```ts
 * import { GCounter, increment } from "effect-crdts/GCounter"
 * import * as Effect from "effect/Effect"
 * import * as STM from "effect/STM"
 *
 * const program = Effect.gen(function* () {
 *   const counter = yield* GCounter
 *   yield* STM.commit(increment(counter, 5))
 * })
 * ```
 *
 * @since 0.1.0
 * @category operations
 */
export const increment: {
  (value?: number): (counter: Counter) => STM.STM<void>
  (counter: Counter, value?: number): STM.STM<void>
} = dual(
  (args) => isCounter(args[0]),
  (counter: Counter, value?: number): STM.STM<void> => counter.increment(value)
)

/**
 * Get the current value of a counter.
 *
 * @example
 * ```ts
 * import { GCounter, value } from "effect-crdts/GCounter"
 * import * as Effect from "effect/Effect"
 * import * as STM from "effect/STM"
 *
 * const program = Effect.gen(function* () {
 *   const counter = yield* GCounter
 *   const val = yield* STM.commit(value(counter))
 *   console.log("Value:", val)
 * })
 * ```
 *
 * @since 0.1.0
 * @category getters
 */
export const value = (counter: Counter): STM.STM<number> => counter.value

/**
 * Merge another counter's state into this counter.
 *
 * @example
 * ```ts
 * import { make, merge, increment, value, ReplicaId } from "effect-crdts/GCounter"
 * import * as Effect from "effect/Effect"
 * import * as STM from "effect/STM"
 *
 * const program = Effect.gen(function* () {
 *   const counter1 = yield* make(ReplicaId("replica-1"))
 *   const counter2 = yield* make(ReplicaId("replica-2"))
 *
 *   yield* STM.commit(increment(counter1, 5))
 *   yield* STM.commit(increment(counter2, 3))
 *
 *   const state2 = yield* STM.commit(counter2.query)
 *   yield* STM.commit(merge(counter1, state2))
 *
 *   const val = yield* STM.commit(value(counter1))
 *   console.log("Merged value:", val) // 8
 * })
 * ```
 *
 * @since 0.1.0
 * @category operations
 */
export const merge: {
  (other: CounterState): (counter: Counter) => STM.STM<void>
  (counter: Counter, other: CounterState): STM.STM<void>
} = dual(2, (counter: Counter, other: CounterState): STM.STM<void> => counter.merge(other))

/**
 * Get the current state of a counter.
 *
 * @since 0.1.0
 * @category getters
 */
export const query = (counter: Counter): STM.STM<CounterState> => counter.query
