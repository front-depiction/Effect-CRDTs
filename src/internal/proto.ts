/**
 * Shared Proto object utilities for CRDTs.
 *
 * Provides common implementations of Equal, Hash, Inspectable, and Pipeable
 * protocols to reduce duplication across CRDT implementations.
 *
 * @since 0.1.0
 * @internal
 */

import * as Effect from "effect/Effect"
import * as Equal from "effect/Equal"
import { format, NodeInspectSymbol } from "effect/Inspectable"
import { pipeArguments } from "effect/Pipeable"
import * as Predicate from "effect/Predicate"
import * as STM from "effect/STM"
import * as TRef from "effect/TRef"
import { CRDTTypeId } from "../CRDT.js"

/**
 * Common CRDT interface for Proto implementations.
 * @internal
 */
interface CRDTWithState<S> {
  readonly [CRDTTypeId]: typeof CRDTTypeId
  readonly stateRef: TRef.TRef<S>
  toJSON(): unknown
}

/**
 * Type guard to check if a value has the CRDT type ID.
 *
 * Provides a consistent type guard implementation across all CRDTs.
 *
 * @internal
 */
export const isCRDT = (u: unknown): u is { readonly [CRDTTypeId]: typeof CRDTTypeId } =>
  Predicate.hasProperty(u, CRDTTypeId)

/**
 * Creates common Proto object methods for CRDTs.
 *
 * This factory provides consistent implementations of:
 * - Symbol.iterator (delegates to stateRef)
 * - NodeInspectSymbol (delegates to toJSON)
 * - toString (uses format)
 * - pipe (uses pipeArguments)
 *
 * @internal
 */
export const makeProtoBase = <S>(typeId: symbol) => ({
  [typeId]: typeId,
  [NodeInspectSymbol](this: CRDTWithState<S>) {
    return this.toJSON()
  },
  toString(this: CRDTWithState<S>) {
    return format(this)
  },
  pipe() {
    return pipeArguments(this, arguments)
  }
})

/**
 * Standard Equal implementation for CRDTs.
 *
 * Compares two CRDT instances by comparing their state using Effect's Equal.
 * This runs synchronously using STM.commit and Effect.runSync.
 *
 * @internal
 */
export const makeEqualImpl = <T extends CRDTWithState<any>>(
  typeGuard: (u: unknown) => u is T
) =>
(self: T, that: Equal.Equal): boolean => {
  if (!typeGuard(that)) {
    return false
  }
  return STM.all([TRef.get(self.stateRef), TRef.get(that.stateRef)]).pipe(
    STM.map(([thisState, thatState]) => Equal.equals(thisState, thatState)),
    STM.commit,
    Effect.runSync
  )
}

/**
 * Reads state synchronously from a CRDT's state reference.
 *
 * @internal
 */
export const getStateSync = <S>(stateRef: TRef.TRef<S>): S =>
  TRef.get(stateRef).pipe(STM.commit, Effect.runSync)
