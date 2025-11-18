/**
 * Unit tests for G-Counter CRDT.
 *
 * @since 0.1.0
 */

import { describe, it, expect } from "vitest"
import * as Effect from "effect/Effect"
import * as STM from "effect/STM"
import * as GCounter from "../../src/GCounter"
import { ReplicaId } from "../../src/CRDT"

describe("GCounter", () => {
  it("should start with value 0", async () => {
    const program = Effect.gen(function* () {
      const counter = yield* GCounter.make(ReplicaId("replica-1"))
      return yield* STM.commit(counter.value)
    })

    const result = await Effect.runPromise(program)
    expect(result).toBe(0)
  })

  it("should increment correctly", async () => {
    const program = Effect.gen(function* () {
      const counter = yield* GCounter.make(ReplicaId("replica-1"))

      yield* STM.commit(counter.increment(5))
      const val1 = yield* STM.commit(counter.value)

      yield* STM.commit(counter.increment(3))
      const val2 = yield* STM.commit(counter.value)

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

      yield* STM.commit(counter1.increment(10))
      yield* STM.commit(counter2.increment(20))

      const state2 = yield* STM.commit(counter2.query)
      yield* STM.commit(counter1.merge(state2))

      return yield* STM.commit(counter1.value)
    })

    const result = await Effect.runPromise(program)
    expect(result).toBe(30)
  })

  it("should handle multiple merges", async () => {
    const program = Effect.gen(function* () {
      const counter1 = yield* GCounter.make(ReplicaId("replica-1"))
      const counter2 = yield* GCounter.make(ReplicaId("replica-2"))
      const counter3 = yield* GCounter.make(ReplicaId("replica-3"))

      yield* STM.commit(counter1.increment(5))
      yield* STM.commit(counter2.increment(10))
      yield* STM.commit(counter3.increment(15))

      const state1 = yield* STM.commit(counter1.query)
      const state2 = yield* STM.commit(counter2.query)
      const state3 = yield* STM.commit(counter3.query)

      const merged = yield* GCounter.make(ReplicaId("merged"))
      yield* STM.commit(merged.merge(state1))
      yield* STM.commit(merged.merge(state2))
      yield* STM.commit(merged.merge(state3))

      return yield* STM.commit(merged.value)
    })

    const result = await Effect.runPromise(program)
    expect(result).toBe(30)
  })

  it("should not support decrement", async () => {
    const program = Effect.gen(function* () {
      const counter = yield* GCounter.make(ReplicaId("replica-1"))
      yield* STM.commit(counter.increment(10))

      return yield* STM.commit(counter.decrement())
    })

    await expect(Effect.runPromise(program)).rejects.toThrow()
  })

  it("should handle increment by zero", async () => {
    const program = Effect.gen(function* () {
      const counter = yield* GCounter.make(ReplicaId("replica-1"))
      yield* STM.commit(counter.increment(0))
      return yield* STM.commit(counter.value)
    })

    const result = await Effect.runPromise(program)
    expect(result).toBe(0)
  })

  it("should use Layer for dependency injection", async () => {
    const program = Effect.gen(function* () {
      const counter = yield* GCounter.GCounter

      yield* STM.commit(counter.increment(42))
      return yield* STM.commit(counter.value)
    })

    const result = await Effect.runPromise(
      program.pipe(Effect.provide(GCounter.GCounter.Live(ReplicaId("replica-1"))))
    )

    expect(result).toBe(42)
  })

  it("should handle concurrent increments from same replica", async () => {
    const program = Effect.gen(function* () {
      const counter = yield* GCounter.make(ReplicaId("replica-1"))

      // Simulate concurrent increments (they will be sequential in STM)
      yield* STM.commit(counter.increment(1))
      yield* STM.commit(counter.increment(2))
      yield* STM.commit(counter.increment(3))

      return yield* STM.commit(counter.value)
    })

    const result = await Effect.runPromise(program)
    expect(result).toBe(6)
  })

  it("should preserve state after multiple merges", async () => {
    const program = Effect.gen(function* () {
      const counter1 = yield* GCounter.make(ReplicaId("replica-1"))
      const counter2 = yield* GCounter.make(ReplicaId("replica-2"))

      yield* STM.commit(counter1.increment(5))

      // Merge counter2 with counter1
      const state1 = yield* STM.commit(counter1.query)
      yield* STM.commit(counter2.merge(state1))

      // Both should now have same value
      const val1 = yield* STM.commit(counter1.value)
      const val2 = yield* STM.commit(counter2.value)

      // Increment on counter2
      yield* STM.commit(counter2.increment(10))

      // Merge back to counter1
      const state2 = yield* STM.commit(counter2.query)
      yield* STM.commit(counter1.merge(state2))

      const finalVal = yield* STM.commit(counter1.value)

      return { val1, val2, finalVal }
    })

    const result = await Effect.runPromise(program)
    expect(result.val1).toBe(5)
    expect(result.val2).toBe(5)
    expect(result.finalVal).toBe(15)
  })
})
