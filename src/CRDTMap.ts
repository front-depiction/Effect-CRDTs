/**
 * Map CRDT state types.
 *
 * Provides state type definitions for map-based CRDTs.
 * These state types are used for persistence and serialization.
 *
 * @since 0.1.0
 */
import type { ReplicaId } from "./CRDT.js"
import type { RegisterState } from "./CRDTRegister.js"

// =============================================================================
// Models
// =============================================================================

/**
 * State of an LWW-Map (Last-Write-Wins Map) CRDT.
 *
 * An LWW-Map is a map where each key is associated with an LWW-Register.
 * Conflicts are resolved using timestamps (last write wins).
 *
 * @since 0.1.0
 * @category models
 */
export interface LWWMapState<K, V> {
  readonly type: "LWWMap"
  readonly replicaId: ReplicaId
  readonly entries: ReadonlyMap<K, RegisterState<V>>
}

/**
 * State of an OR-Map (Observed-Remove Map) CRDT.
 *
 * An OR-Map is a map where each key can be added and removed, and entries
 * can be re-added after removal. Uses causal tracking to resolve conflicts.
 *
 * @since 0.1.0
 * @category models
 */
export interface ORMapState<K, V> {
  readonly type: "ORMap"
  readonly replicaId: ReplicaId
  readonly entries: ReadonlyMap<K, RegisterState<V>>
}

/**
 * Discriminated union of all map CRDT states.
 *
 * @since 0.1.0
 * @category models
 */
export type MapState<K, V> = LWWMapState<K, V> | ORMapState<K, V>
