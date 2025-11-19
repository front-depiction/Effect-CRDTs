/**
 * Shared Proto object utilities for CRDTs.
 *
 * Provides common implementations of Equal, Hash, Inspectable, and Pipeable
 * protocols to reduce duplication across CRDT implementations.
 *
 * @since 0.1.0
 * @internal
 */

import { format, NodeInspectSymbol } from "effect/Inspectable"
import { pipeArguments } from "effect/Pipeable"
import * as Predicate from "effect/Predicate"
import * as TRef from "effect/TRef"
import { CRDTTypeId } from "../CRDT.js"

/**
 * Common CRDT interface for Proto implementations.
 * @internal
 */
interface CRDTWithState<S> {
  readonly [CRDTTypeId]: typeof CRDTTypeId
  readonly stateRef: TRef.TRef<S>
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
 * - NodeInspectSymbol (uses format for inspection)
 * - toString (uses format)
 * - pipe (uses pipeArguments)
 *
 * @internal
 */
export const makeProtoBase = <S>(typeId: symbol) => ({
  [typeId]: typeId,
  [NodeInspectSymbol](this: CRDTWithState<S>) {
    return format(this)
  },
  toString(this: CRDTWithState<S>) {
    return format(this)
  },
  pipe() {
    return pipeArguments(this, arguments)
  }
})

