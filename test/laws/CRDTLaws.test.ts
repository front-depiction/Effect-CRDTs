/**
 * Property-based tests for CRDT laws.
 *
 * These tests verify that CRDTs satisfy the mathematical properties required
 * for strong eventual consistency:
 * - Commutativity: merge(a, b) = merge(b, a)
 * - Associativity: merge(merge(a, b), c) = merge(a, merge(b, c))
 * - Idempotence: merge(a, a) = a
 *
 * @since 0.1.0
 */

import { describe, it, expect } from "vitest"
import * as Array from "effect/Array"
import * as Effect from "effect/Effect"
import * as FastCheck from "effect/FastCheck"
import * as STM from "effect/STM"
import * as GCounter from "../../src/GCounter"
import * as PNCounter from "../../src/PNCounter"
import * as GSet from "../../src/GSet"
import { ReplicaId } from "../../src/CRDT"

describe("CRDT Laws", () => {
  describe("G-Counter", () => {
    describe("Commutativity", () => {
      it("merge(a, b) = merge(b, a)", async () => FastCheck.assert(
        FastCheck.asyncProperty(
          FastCheck
            .record({
              replicaA: FastCheck.string().filter((s) => s.length > 0),
              replicaB: FastCheck.string().filter((s) => s.length > 0),
              valueA: FastCheck.nat({ max: 1000 }),
              valueB: FastCheck.nat({ max: 1000 })
            })
            .filter(({ replicaA, replicaB }) => replicaA !== replicaB),
          async ({ replicaA, replicaB, valueA, valueB }) => {
            const program = Effect.gen(function* () {
              // Create two counters on different replicas
              const counter1 = yield* GCounter.make(ReplicaId(replicaA))
              const counter2 = yield* GCounter.make(ReplicaId(replicaB))

              // Increment both counters
              yield* STM.commit(counter1.increment(valueA))
              yield* STM.commit(counter2.increment(valueB))

              // Get states
              const stateA = yield* STM.commit(counter1.query)
              const stateB = yield* STM.commit(counter2.query)

              // Test merge(A, B)
              const counterAB1 = yield* GCounter.make(ReplicaId("test-ab1"))
              const counterAB2 = yield* GCounter.make(ReplicaId("test-ab2"))

              yield* STM.commit(counterAB1.merge(stateA))
              yield* STM.commit(counterAB1.merge(stateB))
              const resultAB = yield* STM.commit(counterAB1.value)

              // Test merge(B, A)
              yield* STM.commit(counterAB2.merge(stateB))
              yield* STM.commit(counterAB2.merge(stateA))
              const resultBA = yield* STM.commit(counterAB2.value)

              return resultAB === resultBA && resultAB === valueA + valueB
            })

            const result = await Effect.runPromise(program)
            expect(result).toBe(true)
          }
        ),
        { numRuns: 50 }
      ))
    })

    describe("Associativity", () => {
      it("merge(merge(a, b), c) = merge(a, merge(b, c))", async () => FastCheck.assert(
        FastCheck.asyncProperty(
          FastCheck
            .record({
              replicaA: FastCheck.string().filter((s) => s.length > 0),
              replicaB: FastCheck.string().filter((s) => s.length > 0),
              replicaC: FastCheck.string().filter((s) => s.length > 0),
              valueA: FastCheck.nat({ max: 1000 }),
              valueB: FastCheck.nat({ max: 1000 }),
              valueC: FastCheck.nat({ max: 1000 })
            })
            .filter(
              ({ replicaA, replicaB, replicaC }) =>
                replicaA !== replicaB && replicaB !== replicaC && replicaA !== replicaC
            ),
          async ({ replicaA, replicaB, replicaC, valueA, valueB, valueC }) => {
            const program = Effect.gen(function* () {
              // Create three counters
              const counterA = yield* GCounter.make(ReplicaId(replicaA))
              const counterB = yield* GCounter.make(ReplicaId(replicaB))
              const counterC = yield* GCounter.make(ReplicaId(replicaC))

              yield* STM.commit(counterA.increment(valueA))
              yield* STM.commit(counterB.increment(valueB))
              yield* STM.commit(counterC.increment(valueC))

              const stateA = yield* STM.commit(counterA.query)
              const stateB = yield* STM.commit(counterB.query)
              const stateC = yield* STM.commit(counterC.query)

              // Test merge(merge(a, b), c)
              const counterLeft = yield* GCounter.make(ReplicaId("test-left"))
              yield* STM.commit(counterLeft.merge(stateA))
              yield* STM.commit(counterLeft.merge(stateB))
              yield* STM.commit(counterLeft.merge(stateC))
              const resultLeft = yield* STM.commit(counterLeft.value)

              // Test merge(a, merge(b, c))
              const counterRight = yield* GCounter.make(ReplicaId("test-right"))
              yield* STM.commit(counterRight.merge(stateB))
              yield* STM.commit(counterRight.merge(stateC))
              yield* STM.commit(counterRight.merge(stateA))
              const resultRight = yield* STM.commit(counterRight.value)

              return resultLeft === resultRight && resultLeft === valueA + valueB + valueC
            })

            const result = await Effect.runPromise(program)
            expect(result).toBe(true)
          }
        ),
        { numRuns: 50 }
      ))
    })

    describe("Idempotence", () => {
      it("merge(a, a) = a", async () => FastCheck.assert(
        FastCheck.asyncProperty(
          FastCheck.record({
            replica: FastCheck.string().filter((s) => s.length > 0),
            value: FastCheck.nat({ max: 1000 })
          }),
          async ({ replica, value }) => {
            const program = Effect.gen(function* () {
              const counter = yield* GCounter.make(ReplicaId(replica))
              yield* STM.commit(counter.increment(value))

              const valueBefore = yield* STM.commit(counter.value)
              const state = yield* STM.commit(counter.query)

              // Merge with itself
              yield* STM.commit(counter.merge(state))

              const valueAfter = yield* STM.commit(counter.value)

              return valueBefore === valueAfter && valueBefore === value
            })

            const result = await Effect.runPromise(program)
            expect(result).toBe(true)
          }
        ),
        { numRuns: 50 }
      )
      )
    })

    describe("Monotonicity", () => {
      it("values only increase for G-Counter", async () => {
        const program = Effect.gen(function* () {
          const counter = yield* GCounter.make(ReplicaId("monotonic-test"))

          const values = yield* Effect.forEach(
            Array.makeBy(10, (i) => i + 1),
            (increment) => Effect.gen(function* () {
              yield* STM.commit(counter.increment(increment))
              return yield* STM.commit(counter.value)
            })
          )

          // Check that each value is >= the previous
          return values.every((val, i) => i === 0 || val >= values[i - 1])
        })

        const result = await Effect.runPromise(program)
        expect(result).toBe(true)
      })
    })
  })

  describe("PN-Counter", () => {
    describe("Commutativity", () => {
      it("merge(a, b) = merge(b, a) with increments and decrements", async () => FastCheck.assert(
        FastCheck.asyncProperty(
          FastCheck
            .record({
              replicaA: FastCheck.string().filter((s) => s.length > 0),
              replicaB: FastCheck.string().filter((s) => s.length > 0),
              incA: FastCheck.nat({ max: 1000 }),
              decA: FastCheck.nat({ max: 1000 }),
              incB: FastCheck.nat({ max: 1000 }),
              decB: FastCheck.nat({ max: 1000 })
            })
            .filter(({ replicaA, replicaB }) => replicaA !== replicaB),
          async ({ replicaA, replicaB, incA, decA, incB, decB }) => {
            const program = Effect.gen(function* () {
              const counter1 = yield* PNCounter.make(ReplicaId(replicaA))
              const counter2 = yield* PNCounter.make(ReplicaId(replicaB))

              yield* STM.commit(counter1.increment(incA))
              yield* STM.commit(counter1.decrement(decA))
              yield* STM.commit(counter2.increment(incB))
              yield* STM.commit(counter2.decrement(decB))

              const stateA = yield* STM.commit(counter1.query)
              const stateB = yield* STM.commit(counter2.query)

              // Test merge(A, B)
              const counterAB = yield* PNCounter.make(ReplicaId("test-ab"))
              yield* STM.commit(counterAB.merge(stateA))
              yield* STM.commit(counterAB.merge(stateB))
              const resultAB = yield* STM.commit(counterAB.value)

              // Test merge(B, A)
              const counterBA = yield* PNCounter.make(ReplicaId("test-ba"))
              yield* STM.commit(counterBA.merge(stateB))
              yield* STM.commit(counterBA.merge(stateA))
              const resultBA = yield* STM.commit(counterBA.value)

              const expected = incA - decA + incB - decB
              return resultAB === resultBA && resultAB === expected
            })

            const result = await Effect.runPromise(program)
            expect(result).toBe(true)
          }
        ),
        { numRuns: 50 }
      )
      )
    })

    describe("Idempotence", () => {
      it("merge(a, a) = a", async () => FastCheck.assert(
        FastCheck.asyncProperty(
          FastCheck.record({
            replica: FastCheck.string().filter((s) => s.length > 0),
            inc: FastCheck.nat({ max: 1000 }),
            dec: FastCheck.nat({ max: 1000 })
          }),
          async ({ replica, inc, dec }) => {
            const program = Effect.gen(function* () {
              const counter = yield* PNCounter.make(ReplicaId(replica))
              yield* STM.commit(counter.increment(inc))
              yield* STM.commit(counter.decrement(dec))

              const valueBefore = yield* STM.commit(counter.value)
              const state = yield* STM.commit(counter.query)

              // Merge with itself
              yield* STM.commit(counter.merge(state))

              const valueAfter = yield* STM.commit(counter.value)

              return valueBefore === valueAfter && valueBefore === inc - dec
            })

            const result = await Effect.runPromise(program)
            expect(result).toBe(true)
          }
        ),
        { numRuns: 50 }
      ))
    })
  })

  describe("G-Set", () => {
    describe("Commutativity", () => {
      it("merge(a, b) = merge(b, a)", async () => FastCheck.assert(
        FastCheck.asyncProperty(
          FastCheck
            .record({
              replicaA: FastCheck.string().filter((s) => s.length > 0),
              replicaB: FastCheck.string().filter((s) => s.length > 0),
              itemsA: FastCheck.array(FastCheck.string(), { maxLength: 10 }),
              itemsB: FastCheck.array(FastCheck.string(), { maxLength: 10 })
            })
            .filter(({ replicaA, replicaB }) => replicaA !== replicaB),
          async ({ replicaA, replicaB, itemsA, itemsB }) => {
            const program = Effect.gen(function* () {
              const set1 = yield* GSet.make<string>(ReplicaId(replicaA))
              const set2 = yield* GSet.make<string>(ReplicaId(replicaB))

              // Add items to both sets
              yield* Effect.forEach(itemsA, (item) => STM.commit(set1.add(item)))
              yield* Effect.forEach(itemsB, (item) => STM.commit(set2.add(item)))

              const stateA = yield* STM.commit(set1.query)
              const stateB = yield* STM.commit(set2.query)

              // Test merge(A, B)
              const setAB = yield* GSet.make<string>(ReplicaId("test-ab"))
              yield* STM.commit(setAB.merge(stateA))
              yield* STM.commit(setAB.merge(stateB))
              const resultAB = yield* STM.commit(setAB.values)

              // Test merge(B, A)
              const setBA = yield* GSet.make<string>(ReplicaId("test-ba"))
              yield* STM.commit(setBA.merge(stateB))
              yield* STM.commit(setBA.merge(stateA))
              const resultBA = yield* STM.commit(setBA.values)

              // Compare sets
              if (resultAB.size !== resultBA.size) return false
              for (const item of resultAB) {
                if (!resultBA.has(item)) return false
              }
              return true
            })

            const result = await Effect.runPromise(program)
            expect(result).toBe(true)
          }
        ),
        { numRuns: 50 }
      ))
    })

    describe("Idempotence", () => {
      it("merge(a, a) = a", async () => FastCheck.assert(
        FastCheck.asyncProperty(
          FastCheck.record({
            replica: FastCheck.string().filter((s) => s.length > 0),
            items: FastCheck.array(FastCheck.string(), { maxLength: 10 })
          }),
          async ({ replica, items }) => {
            const program = Effect.gen(function* () {
              const set = yield* GSet.make<string>(ReplicaId(replica))

              yield* Effect.forEach(items, (item) => STM.commit(set.add(item)))

              const sizeBefore = yield* STM.commit(set.size)
              const state = yield* STM.commit(set.query)

              // Merge with itself
              yield* STM.commit(set.merge(state))

              const sizeAfter = yield* STM.commit(set.size)

              return sizeBefore === sizeAfter
            })

            const result = await Effect.runPromise(program)
            expect(result).toBe(true)
          }
        ),
        { numRuns: 50 }
      ))
    })

    describe("Monotonicity", () => {
      it("set only grows for G-Set", async () => {
        const program = Effect.gen(function* () {
          const set = yield* GSet.make<string>(ReplicaId("monotonic-test"))

          const sizes = yield* Effect.forEach(
            Array.makeBy(10, (i) => i),
            (i) => Effect.gen(function* () {
              yield* STM.commit(set.add(`item-${i}`))
              return yield* STM.commit(set.size)
            })
          )

          // Check that each size is >= the previous
          return sizes.every((size, i) => i === 0 || size >= sizes[i - 1])
        })

        const result = await Effect.runPromise(program)
        expect(result).toBe(true)
      })
    })
  })
})
