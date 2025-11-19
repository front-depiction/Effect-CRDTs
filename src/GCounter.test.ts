/**
 * Unit tests for G-Counter CRDT.
 *
 * @since 0.1.0
 */

import { describe, it, expect } from "vitest"
import * as Effect from "effect/Effect"
import * as STM from "effect/STM"
import * as GCounter from "./GCounter"
import { ReplicaId } from "./CRDT"

describe("GCounter", () => {
  it("should start with value 0", async () => {
    const program = Effect.gen(function* () {
      const counter = yield* GCounter.make(ReplicaId("replica-1"))
      return yield* STM.commit(GCounter.value(counter))
    })

    const result = await Effect.runPromise(program)
    expect(result).toBe(0)
  })

  it("should increment correctly", async () => {
    const program = Effect.gen(function* () {
      const counter = yield* GCounter.make(ReplicaId("replica-1"))

      yield* STM.commit(GCounter.increment(counter, 5))
      const val1 = yield* STM.commit(GCounter.value(counter))

      yield* STM.commit(GCounter.increment(counter, 3))
      const val2 = yield* STM.commit(GCounter.value(counter))

      return { val1, val2 }
    })

    const result = await Effect.runPromise(program)
    expect(result.val1).toBe(5)
    expect(result.val2).toBe(8)
  })

  it("should merge states correctly", async () => {
    const program = Effect.gen(function* () {
      const counter1 = yield* GCounter.make(ReplicaId("replica-1"))
      const counter2 = yield* GCounter.make(ReplicaId("replica-2"))

      yield* STM.commit(GCounter.increment(counter1, 10))
      yield* STM.commit(GCounter.increment(counter2, 20))

      const state2 = yield* STM.commit(GCounter.query(counter2))
      yield* STM.commit(GCounter.merge(counter1, state2))

      return yield* STM.commit(GCounter.value(counter1))
    })

    const result = await Effect.runPromise(program)
    expect(result).toBe(30)
  })

  it("should handle multiple merges", async () => {
    const program = Effect.gen(function* () {
      const counter1 = yield* GCounter.make(ReplicaId("replica-1"))
      const counter2 = yield* GCounter.make(ReplicaId("replica-2"))
      const counter3 = yield* GCounter.make(ReplicaId("replica-3"))

      yield* STM.commit(GCounter.increment(counter1, 5))
      yield* STM.commit(GCounter.increment(counter2, 10))
      yield* STM.commit(GCounter.increment(counter3, 15))

      const state1 = yield* STM.commit(GCounter.query(counter1))
      const state2 = yield* STM.commit(GCounter.query(counter2))
      const state3 = yield* STM.commit(GCounter.query(counter3))

      const merged = yield* GCounter.make(ReplicaId("merged"))
      yield* STM.commit(GCounter.merge(merged, state1))
      yield* STM.commit(GCounter.merge(merged, state2))
      yield* STM.commit(GCounter.merge(merged, state3))

      return yield* STM.commit(GCounter.value(merged))
    })

    const result = await Effect.runPromise(program)
    expect(result).toBe(30)
  })

  it("should not support negative increment", async () => {
    const program = Effect.gen(function* () {
      const counter = yield* GCounter.make(ReplicaId("replica-1"))
      yield* STM.commit(GCounter.increment(counter, 10))

      return yield* STM.commit(GCounter.increment(counter, -5))
    })

    await expect(Effect.runPromise(program)).rejects.toThrow()
  })

  it("should handle increment by zero", async () => {
    const program = Effect.gen(function* () {
      const counter = yield* GCounter.make(ReplicaId("replica-1"))
      yield* STM.commit(GCounter.increment(counter, 0))
      return yield* STM.commit(GCounter.value(counter))
    })

    const result = await Effect.runPromise(program)
    expect(result).toBe(0)
  })

  it("should use Layer for dependency injection", async () => {
    const program = Effect.gen(function* () {
      const counter = yield* GCounter.Tag

      yield* STM.commit(GCounter.increment(counter, 42))
      return yield* STM.commit(GCounter.value(counter))
    })

    const result = await Effect.runPromise(
      program.pipe(Effect.provide(GCounter.Live(ReplicaId("replica-1"))))
    )

    expect(result).toBe(42)
  })

  it("should handle concurrent increments from same replica", async () => {
    const program = Effect.gen(function* () {
      const counter = yield* GCounter.make(ReplicaId("replica-1"))

      // Simulate concurrent increments (they will be sequential in STM)
      yield* STM.commit(GCounter.increment(counter, 1))
      yield* STM.commit(GCounter.increment(counter, 2))
      yield* STM.commit(GCounter.increment(counter, 3))

      return yield* STM.commit(GCounter.value(counter))
    })

    const result = await Effect.runPromise(program)
    expect(result).toBe(6)
  })

  it("should preserve state after multiple merges", async () => {
    const program = Effect.gen(function* () {
      const counter1 = yield* GCounter.make(ReplicaId("replica-1"))
      const counter2 = yield* GCounter.make(ReplicaId("replica-2"))

      yield* STM.commit(GCounter.increment(counter1, 5))

      // Merge counter2 with counter1
      const state1 = yield* STM.commit(GCounter.query(counter1))
      yield* STM.commit(GCounter.merge(counter2, state1))

      // Both should now have same value
      const val1 = yield* STM.commit(GCounter.value(counter1))
      const val2 = yield* STM.commit(GCounter.value(counter2))

      // Increment on counter2
      yield* STM.commit(GCounter.increment(counter2, 10))

      // Merge back to counter1
      const state2 = yield* STM.commit(GCounter.query(counter2))
      yield* STM.commit(GCounter.merge(counter1, state2))

      const finalVal = yield* STM.commit(GCounter.value(counter1))

      return { val1, val2, finalVal }
    })

    const result = await Effect.runPromise(program)
    expect(result.val1).toBe(5)
    expect(result.val2).toBe(5)
    expect(result.finalVal).toBe(15)
  })
})
