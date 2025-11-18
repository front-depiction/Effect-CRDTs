/**
 * Core CRDT (Conflict-free Replicated Data Type) interfaces and types.
 *
 * @since 0.1.0
 */
import * as  Brand from "effect/Brand"
import type * as Equal from "effect/Equal"
import type * as Hash from "effect/Hash"
import type * as Inspectable from "effect/Inspectable"
import type * as Option from "effect/Option"
import type * as Pipeable from "effect/Pipeable"
import type * as STM from "effect/STM"

/**
 * Core CRDT type identifier.
 *
 * @since 0.1.0
 * @category symbols
 */
export const CRDTTypeId: unique symbol = Symbol.for("effect-crdts/CRDT")

/**
 * Core CRDT type identifier type.
 *
 * @since 0.1.0
 * @category symbols
 */
export type CRDTTypeId = typeof CRDTTypeId

/**
 * Replica ID for identifying different CRDT instances.
 *
 * @since 0.1.0
 * @category models
 */
export type ReplicaId = Brand.Branded<string, "ReplicaId">

/**
 * Creates a replica ID from a string.
 *
 * @since 0.1.0
 * @category constructors
 */
export const ReplicaId = Brand.nominal<ReplicaId>()

/**
 * Base CRDT interface that all CRDTs implement.
 *
 * A CRDT (Conflict-free Replicated Data Type) is a data structure that can be
 * replicated across multiple nodes and merged without conflicts. CRDTs guarantee
 * strong eventual consistency: all replicas that have received the same set of
 * updates will converge to the same state.
 *
 * @since 0.1.0
 * @category models
 */
export interface CRDT<State, Delta = State>
  extends Equal.Equal, Hash.Hash, Pipeable.Pipeable, Inspectable.Inspectable {
  readonly [CRDTTypeId]: CRDTTypeId

  /**
   * Get the current state of the CRDT.
   *
   * @since 0.1.0
   */
  readonly query: STM.STM<State>

  /**
   * Merge another state into this CRDT.
   *
   * The merge operation must be:
   * - Commutative: merge(a, b) = merge(b, a)
   * - Associative: merge(merge(a, b), c) = merge(a, merge(b, c))
   * - Idempotent: merge(a, a) = a
   *
   * @since 0.1.0
   */
  readonly merge: (other: State) => STM.STM<void>

  /**
   * Get delta (changes) since last synchronization.
   *
   * Returns None if there are no changes to synchronize.
   *
   * @since 0.1.0
   */
  readonly delta: STM.STM<Option.Option<Delta>>

  /**
   * Apply a delta to this CRDT.
   *
   * @since 0.1.0
   */
  readonly applyDelta: (delta: Delta) => STM.STM<void>
}

/**
 * Counter-specific operations for grow-only and positive-negative counters.
 *
 * @since 0.1.0
 * @category models
 */
export interface Counter extends CRDT<CounterState> {
  /** @internal */
  readonly stateRef: any

  /** @internal */
  readonly replicaId: ReplicaId

  /**
   * Increment the counter by the specified value (default: 1).
   *
   * @since 0.1.0
   */
  readonly increment: (value?: number) => STM.STM<void>

  /**
   * Decrement the counter by the specified value (default: 1).
   *
   * Only supported for PN-Counter. G-Counter will fail.
   *
   * @since 0.1.0
   */
  readonly decrement: (value?: number) => STM.STM<void>

  /**
   * Get the current counter value.
   *
   * @since 0.1.0
   */
  readonly value: STM.STM<number>
}

/**
 * State of a counter CRDT.
 *
 * @since 0.1.0
 * @category models
 */
export interface CounterState {
  readonly type: "GCounter" | "PNCounter"
  readonly replicaId: ReplicaId
  readonly counts: ReadonlyMap<ReplicaId, number>
  readonly decrements?: ReadonlyMap<ReplicaId, number>
}

/**
 * Grow-only set operations for sets that only support additions.
 *
 * Used by G-Set (grow-only set) which cannot remove elements once added.
 *
 * @since 0.1.0
 * @category models
 */
export interface GrowOnlySet<A> extends CRDT<GSetState<A>> {
  /** @internal */
  readonly stateRef: any

  /** @internal */
  readonly replicaId: ReplicaId

  /**
   * Add an element to the set.
   *
   * @since 0.1.0
   */
  readonly add: (value: A) => STM.STM<void>

  /**
   * Check if an element is in the set.
   *
   * @since 0.1.0
   */
  readonly has: (value: A) => STM.STM<boolean>

  /**
   * Get all elements in the set.
   *
   * @since 0.1.0
   */
  readonly values: STM.STM<ReadonlySet<A>>

  /**
   * Get the number of elements in the set.
   *
   * @since 0.1.0
   */
  readonly size: STM.STM<number>
}

/**
 * Set operations with removal support.
 *
 * Extends GrowOnlySet with the ability to remove elements. Used by:
 * - 2P-Set: permanent removal (once removed, cannot be re-added)
 * - OR-Set: removes all observed instances
 *
 * @since 0.1.0
 * @category models
 */
export interface RemovableSet<A> extends GrowOnlySet<A> {
  /**
   * Remove an element from the set.
   *
   * Behavior varies by set type:
   * - 2P-Set: permanent removal
   * - OR-Set: removes all observed instances
   *
   * @since 0.1.0
   */
  readonly remove: (value: A) => STM.STM<void>
}

/**
 * Type alias for all set types (grow-only and removable).
 *
 * @since 0.1.0
 * @category models
 */
export type CRDTSet<A> = GrowOnlySet<A> | RemovableSet<A>

/**
 * State of a G-Set (grow-only set) CRDT.
 *
 * @since 0.1.0
 * @category models
 */
export interface GSetState<A> {
  readonly type: "GSet"
  readonly replicaId: ReplicaId
  readonly added: ReadonlySet<A>
}

/**
 * State of a 2P-Set (two-phase set) CRDT.
 *
 * @since 0.1.0
 * @category models
 */
export interface TwoPSetState<A> {
  readonly type: "TwoPSet"
  readonly replicaId: ReplicaId
  readonly added: ReadonlySet<A>
  readonly removed: ReadonlySet<A>
}

/**
 * State of an OR-Set (observed-remove set) CRDT.
 *
 * @since 0.1.0
 * @category models
 */
export interface ORSetState<A> {
  readonly type: "ORSet"
  readonly replicaId: ReplicaId
  readonly added: ReadonlySet<A>
  readonly tags: ReadonlyMap<A, ReadonlySet<string>>
}

/**
 * Discriminated union of all set CRDT states.
 *
 * @since 0.1.0
 * @category models
 */
export type SetState<A> = GSetState<A> | TwoPSetState<A> | ORSetState<A>

/**
 * Register-specific operations for storing a single value.
 *
 * @since 0.1.0
 * @category models
 */
export interface Register<A> extends CRDT<RegisterState<A>> {
  /**
   * Get the current value of the register.
   *
   * Returns None if no value has been set.
   *
   * @since 0.1.0
   */
  readonly get: STM.STM<Option.Option<A>>

  /**
   * Set the value of the register.
   *
   * @since 0.1.0
   */
  readonly set: (value: A) => STM.STM<void>
}

/**
 * State of a register CRDT.
 *
 * @since 0.1.0
 * @category models
 */
export interface RegisterState<A> {
  readonly type: "LWWRegister" | "MVRegister"
  readonly replicaId: ReplicaId
  readonly value: Option.Option<A>
  readonly timestamp: number
}

/**
 * Map-specific operations for key-value CRDTs.
 *
 * @since 0.1.0
 * @category models
 */
export interface CRDTMap<K, V> extends CRDT<MapState<K, V>> {
  /**
   * Get the value associated with a key.
   *
   * Returns None if the key is not present.
   *
   * @since 0.1.0
   */
  readonly get: (key: K) => STM.STM<Option.Option<V>>

  /**
   * Set the value for a key.
   *
   * @since 0.1.0
   */
  readonly set: (key: K, value: V) => STM.STM<void>

  /**
   * Remove a key from the map.
   *
   * @since 0.1.0
   */
  readonly remove: (key: K) => STM.STM<void>

  /**
   * Check if a key is present in the map.
   *
   * @since 0.1.0
   */
  readonly has: (key: K) => STM.STM<boolean>

  /**
   * Get all entries in the map.
   *
   * @since 0.1.0
   */
  readonly entries: STM.STM<ReadonlyMap<K, V>>

  /**
   * Get the number of entries in the map.
   *
   * @since 0.1.0
   */
  readonly size: STM.STM<number>
}

/**
 * State of a map CRDT.
 *
 * @since 0.1.0
 * @category models
 */
export interface MapState<K, V> {
  readonly type: "LWWMap" | "ORMap"
  readonly replicaId: ReplicaId
  readonly entries: ReadonlyMap<K, RegisterState<V>>
}
