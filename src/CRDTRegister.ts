/**
 * Register CRDT state types.
 *
 * Provides state type definitions for register-based CRDTs.
 * These state types are used for persistence and serialization.
 *
 * @since 0.1.0
 */
import type * as Option from "effect/Option"
import type { ReplicaId } from "./CRDT.js"

// =============================================================================
// Models
// =============================================================================

/**
 * State of an LWW-Register (Last-Write-Wins Register) CRDT.
 *
 * An LWW-Register stores a single value with a timestamp. Conflicts are
 * resolved using timestamps (last write wins).
 *
 * @since 0.1.0
 * @category models
 */
export interface LWWRegisterState<A> {
  readonly type: "LWWRegister"
  readonly replicaId: ReplicaId
  readonly value: Option.Option<A>
  readonly timestamp: number
}

/**
 * State of an MV-Register (Multi-Value Register) CRDT.
 *
 * An MV-Register can store multiple concurrent values when writes happen
 * concurrently. Applications must resolve conflicts by merging or choosing
 * one value.
 *
 * @since 0.1.0
 * @category models
 */
export interface MVRegisterState<A> {
  readonly type: "MVRegister"
  readonly replicaId: ReplicaId
  readonly value: Option.Option<A>
  readonly timestamp: number
}

/**
 * Discriminated union of all register CRDT states.
 *
 * @since 0.1.0
 * @category models
 */
export type RegisterState<A> = LWWRegisterState<A> | MVRegisterState<A>
