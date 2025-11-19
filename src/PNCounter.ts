/**
 * PN-Counter (Positive-Negative Counter) CRDT implementation.
 *
 * A PN-Counter is a state-based CRDT that implements a counter that can be both
 * incremented and decremented. It maintains two G-Counters internally: one for
 * increments (positive) and one for decrements (negative). The value is the
 * difference between the two.
 *
 * Properties:
 * - Supports both increment and decrement
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
import { dual, pipe } from "effect/Function"
import * as Layer from "effect/Layer"
import * as Number from "effect/Number"
import * as Option from "effect/Option"
import * as STM from "effect/STM"
import * as TRef from "effect/TRef"
import type { Mutable } from "effect/Types"
import { CRDTTypeId, type ReplicaId } from "./CRDT.js"
import * as Counter from "./CRDTCounter.js"
import { mergeMaps } from "./internal/merge.js"
import { isCRDT, makeProtoBase } from "./internal/proto.js"
import * as Persistence from "./Persistence.js"

// =============================================================================
// Symbols
// =============================================================================

/**
 * PN-Counter type identifier.
 *
 * @since 0.1.0
 * @category symbols
 */
export const PNCounterTypeId: unique symbol = Symbol.for("effect-crdts/PNCounter")

/**
 * PN-Counter type identifier type.
 *
 * @since 0.1.0
 * @category symbols
 */
export type PNCounterTypeId = typeof PNCounterTypeId

// =============================================================================
// Errors
// =============================================================================

/**
 * Error thrown by PN-Counter operations.
 *
 * @since 0.1.0
 * @category errors
 */
export class PNCounterError extends Data.TaggedError("PNCounterError")<{
  readonly message: string
}> { }

// =============================================================================
// Type Guards
// =============================================================================

/**
 * Type guard to check if a value is a PNCounter.
 *
 * @since 0.1.0
 * @category guards
 */
export const isPNCounter = (u: unknown): u is Counter.Counter =>
  isCRDT(u) && PNCounterTypeId in u

// =============================================================================
// Proto Objects
// =============================================================================

/** @internal */
const ProtoPNCounter = {
  ...makeProtoBase<Counter.CounterState>(CRDTTypeId),
  [Counter.CounterTypeId]: Counter.CounterTypeId,
  [PNCounterTypeId]: PNCounterTypeId
}

// =============================================================================
// Tags
// =============================================================================

/**
 * PN-Counter service tag for dependency injection.
 *
 * @example
 * ```ts
 * import { PNCounter, ReplicaId } from "effect-crdts"
 * import * as Effect from "effect/Effect"
 * import * as STM from "effect/STM"
 *
 * const program = Effect.gen(function* () {
 *   const counter = yield* PNCounter
 *
 *   yield* STM.commit(counter.increment(10))
 *   yield* STM.commit(counter.decrement(3))
 *
 *   const value = yield* STM.commit(counter.value)
 *   console.log("Counter value:", value) // 7
 * })
 *
 * Effect.runPromise(
 *   program.pipe(Effect.provide(PNCounter.Live(ReplicaId("replica-1"))))
 * )
 * ```
 *
 * @since 0.1.0
 * @category tags
 */
export class PNCounter extends Context.Tag("PNCounter")<PNCounter, Counter.Counter>() {
  /**
   * Creates a live layer with no persistence.
   *
   * State will be held in memory and lost when the process exits.
   *
   * @since 0.1.0
   */
  static Live = (replicaId: ReplicaId): Layer.Layer<PNCounter> =>
    Layer.effect(
      this,
      Effect.gen(function* () {
        const stateRef = yield* TRef.make<Counter.CounterState>({
          type: "PNCounter",
          replicaId,
          counts: new Map([[replicaId, 0]]),
          decrements: Option.some(new Map([[replicaId, 0]]))
        })

        return makePNCounter(replicaId, stateRef)
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
        const persistence = basePersistence.forSchema(Counter.CounterState)
        const loadedState: Option.Option<Counter.CounterState> = yield* persistence.load(replicaId)

        const initialState: Counter.CounterState = pipe(
          loadedState,
          Option.getOrElse(() => ({
            type: "PNCounter" as const,
            replicaId,
            counts: new Map([[replicaId, 0]]),
            decrements: Option.some(new Map([[replicaId, 0]]))

          }))
        )

        const stateRef = yield* TRef.make(initialState)
        const counter = makePNCounter(replicaId, stateRef)

        // Setup auto-save on finalization
        yield* Effect.addFinalizer(() =>
          pipe(
            TRef.get(stateRef),
            STM.commit,
            Effect.flatMap((state) => persistence.save(replicaId, state)),
            Effect.ignoreLogged
          )
        )

        return counter
      })
    )
}

/**
 * Internal constructor for PN-Counter.
 *
 * @internal
 */
const makePNCounter = (replicaId: ReplicaId, stateRef: TRef.TRef<Counter.CounterState>): Counter.Counter => {
  const counter: Mutable<Counter.Counter> = Object.create(ProtoPNCounter)
  counter.stateRef = stateRef
  counter.replicaId = replicaId

  counter.query = TRef.get(stateRef)

  counter.merge = (other) =>
    TRef.update(stateRef, (current) => ({
      ...current,
      counts: mergeMaps(current.counts, other.counts, Number.max),
      decrements: Option.some(mergeMaps(
        Option.getOrElse(current.decrements, () => new Map()),
        Option.getOrElse(other.decrements, () => new Map()),
        Number.max
      ))
    }))

  counter.delta = pipe(
    TRef.get(stateRef),
    STM.map((state) => Option.some(state))
  )

  counter.applyDelta = (delta) =>
    TRef.update(stateRef, (current) => ({
      ...current,
      counts: mergeMaps(current.counts, delta.counts, Number.max),
      decrements: Option.some(mergeMaps(
        Option.getOrElse(current.decrements, () => new Map()),
        Option.getOrElse(delta.decrements, () => new Map()),
        Number.max
      ))
    }))

  counter.increment = (value = 1) => {
    if (value < 0) {
      return STM.die(new PNCounterError({ message: "Cannot increment by negative value" }))
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

  counter.decrement = (value = 1) => {
    if (value < 0) {
      return STM.die(new PNCounterError({ message: "Cannot decrement by negative value" }))
    }
    return TRef.update(stateRef, (state) => {
      const currentDecrements = pipe(
        state.decrements,
        Option.getOrElse(() => new Map() as ReadonlyMap<ReplicaId, number>)
      )
      const currentDecrement = currentDecrements.get(replicaId) ?? 0
      const newDecrements = new Map(currentDecrements)
      newDecrements.set(replicaId, currentDecrement + value)
      return {
        ...state,
        decrements: Option.some(newDecrements)
      }
    })
  }

  counter.value = pipe(
    TRef.get(stateRef),
    STM.map((state) => {
      const decrementValues = pipe(
        state.decrements,
        Option.map((m) => Array.fromIterable(m.values())),
        Option.getOrElse(() => [] as readonly number[])
      )
      return Number.subtract(
        Number.sumAll(state.counts.values()),
        Number.sumAll(decrementValues)
      )
    })
  )

  return counter
}

/**
 * Creates a new PN-Counter with the given replica ID.
 *
 * @example
 * ```ts
 * import { make, ReplicaId } from "effect-crdts/PNCounter"
 * import * as Effect from "effect/Effect"
 * import * as STM from "effect/STM"
 *
 * const program = Effect.gen(function* () {
 *   const counter = yield* make(ReplicaId("replica-1"))
 *
 *   yield* STM.commit(counter.increment(10))
 *   yield* STM.commit(counter.decrement(3))
 *   const value = yield* STM.commit(counter.value)
 *
 *   console.log("Value:", value) // 7
 * })
 * ```
 *
 * @since 0.1.0
 * @category constructors
 */
export const make = (replicaId: ReplicaId): Effect.Effect<Counter.Counter> =>
  Effect.gen(function* () {
    const stateRef = yield* TRef.make<Counter.CounterState>({
      type: "PNCounter",
      replicaId,
      counts: new Map([[replicaId, 0]]),
      decrements: Option.some(new Map([[replicaId, 0]]))
    })
    return makePNCounter(replicaId, stateRef)
  })

/**
 * Increment a counter by a value (default: 1).
 *
 * @since 0.1.0
 * @category operations
 */
export const increment: {
  (value?: number): (counter: Counter.Counter) => STM.STM<void>
  (counter: Counter.Counter, value?: number): STM.STM<void>
} = dual(
  (args) => isPNCounter(args[0]),
  (counter: Counter.Counter, value?: number): STM.STM<void> => counter.increment(value)
)

/**
 * Decrement a counter by a value (default: 1).
 *
 * @since 0.1.0
 * @category operations
 */
export const decrement: {
  (value?: number): (counter: Counter.Counter) => STM.STM<void>
  (counter: Counter.Counter, value?: number): STM.STM<void>
} = dual(
  (args) => isPNCounter(args[0]),
  (counter: Counter.Counter, value?: number): STM.STM<void> => counter.decrement(value)
)

/**
 * Get the current value of a counter.
 *
 * @since 0.1.0
 * @category getters
 */
export const value = (counter: Counter.Counter): STM.STM<number> => counter.value

/**
 * Merge another counter's state into this counter.
 *
 * @since 0.1.0
 * @category operations
 */
export const merge: {
  (other: Counter.CounterState): (counter: Counter.Counter) => STM.STM<void>
  (counter: Counter.Counter, other: Counter.CounterState): STM.STM<void>
} = dual(2, (counter: Counter.Counter, other: Counter.CounterState): STM.STM<void> => counter.merge(other))

/**
 * Get the current state of a counter.
 *
 * @since 0.1.0
 * @category getters
 */
export const query = (counter: Counter.Counter): STM.STM<Counter.CounterState> => counter.query
