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
import * as GCounter from "./GCounter"
import * as PNCounter from "./PNCounter"
import * as GSet from "./GSet"
import { ReplicaId } from "./CRDT"

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
              yield* STM.commit(GCounter.increment(counter1, valueA))
              yield* STM.commit(GCounter.increment(counter2, valueB))

              // Get states
              const stateA = yield* STM.commit(GCounter.query(counter1))
              const stateB = yield* STM.commit(GCounter.query(counter2))

              // Test merge(A, B)
              const counterAB1 = yield* GCounter.make(ReplicaId("test-ab1"))
              const counterAB2 = yield* GCounter.make(ReplicaId("test-ab2"))

              yield* STM.commit(GCounter.merge(counterAB1, stateA))
              yield* STM.commit(GCounter.merge(counterAB1, stateB))
              const resultAB = yield* STM.commit(GCounter.value(counterAB1))

              // Test merge(B, A)
              yield* STM.commit(GCounter.merge(counterAB2, stateB))
              yield* STM.commit(GCounter.merge(counterAB2, stateA))
              const resultBA = yield* STM.commit(GCounter.value(counterAB2))

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

              yield* STM.commit(GCounter.increment(counterA, valueA))
              yield* STM.commit(GCounter.increment(counterB, valueB))
              yield* STM.commit(GCounter.increment(counterC, valueC))

              const stateA = yield* STM.commit(GCounter.query(counterA))
              const stateB = yield* STM.commit(GCounter.query(counterB))
              const stateC = yield* STM.commit(GCounter.query(counterC))

              // Test merge(merge(a, b), c)
              const counterLeft = yield* GCounter.make(ReplicaId("test-left"))
              yield* STM.commit(GCounter.merge(counterLeft, stateA))
              yield* STM.commit(GCounter.merge(counterLeft, stateB))
              yield* STM.commit(GCounter.merge(counterLeft, stateC))
              const resultLeft = yield* STM.commit(GCounter.value(counterLeft))

              // Test merge(a, merge(b, c))
              const counterRight = yield* GCounter.make(ReplicaId("test-right"))
              yield* STM.commit(GCounter.merge(counterRight, stateB))
              yield* STM.commit(GCounter.merge(counterRight, stateC))
              yield* STM.commit(GCounter.merge(counterRight, stateA))
              const resultRight = yield* STM.commit(GCounter.value(counterRight))

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
              yield* STM.commit(GCounter.increment(counter, value))

              const valueBefore = yield* STM.commit(GCounter.value(counter))
              const state = yield* STM.commit(GCounter.query(counter))

              // Merge with itself
              yield* STM.commit(GCounter.merge(counter, state))

              const valueAfter = yield* STM.commit(GCounter.value(counter))

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
              yield* STM.commit(GCounter.increment(counter, increment))
              return yield* STM.commit(GCounter.value(counter))
            })
          )

          // Check that each value is >= the previous
          return values.every((val, i) => i === 0 || val >= values[i - 1]!)
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

              yield* STM.commit(PNCounter.increment(counter1, incA))
              yield* STM.commit(PNCounter.decrement(counter1, decA))
              yield* STM.commit(PNCounter.increment(counter2, incB))
              yield* STM.commit(PNCounter.decrement(counter2, decB))

              const stateA = yield* STM.commit(PNCounter.query(counter1))
              const stateB = yield* STM.commit(PNCounter.query(counter2))

              // Test merge(A, B)
              const counterAB = yield* PNCounter.make(ReplicaId("test-ab"))
              yield* STM.commit(PNCounter.merge(counterAB, stateA))
              yield* STM.commit(PNCounter.merge(counterAB, stateB))
              const resultAB = yield* STM.commit(PNCounter.value(counterAB))

              // Test merge(B, A)
              const counterBA = yield* PNCounter.make(ReplicaId("test-ba"))
              yield* STM.commit(PNCounter.merge(counterBA, stateB))
              yield* STM.commit(PNCounter.merge(counterBA, stateA))
              const resultBA = yield* STM.commit(PNCounter.value(counterBA))

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
              yield* STM.commit(PNCounter.increment(counter, inc))
              yield* STM.commit(PNCounter.decrement(counter, dec))

              const valueBefore = yield* STM.commit(PNCounter.value(counter))
              const state = yield* STM.commit(PNCounter.query(counter))

              // Merge with itself
              yield* STM.commit(PNCounter.merge(counter, state))

              const valueAfter = yield* STM.commit(PNCounter.value(counter))

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
              yield* Effect.forEach(itemsA, (item) => STM.commit(GSet.add(set1, item)))
              yield* Effect.forEach(itemsB, (item) => STM.commit(GSet.add(set2, item)))

              const stateA = yield* STM.commit(GSet.query(set1))
              const stateB = yield* STM.commit(GSet.query(set2))

              // Test merge(A, B)
              const setAB = yield* GSet.make<string>(ReplicaId("test-ab"))
              yield* STM.commit(GSet.merge(setAB, stateA))
              yield* STM.commit(GSet.merge(setAB, stateB))
              const resultAB = yield* STM.commit(GSet.values(setAB))

              // Test merge(B, A)
              const setBA = yield* GSet.make<string>(ReplicaId("test-ba"))
              yield* STM.commit(GSet.merge(setBA, stateB))
              yield* STM.commit(GSet.merge(setBA, stateA))
              const resultBA = yield* STM.commit(GSet.values(setBA))

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

              yield* Effect.forEach(items, (item) => STM.commit(GSet.add(set, item)))

              const sizeBefore = yield* STM.commit(GSet.size(set))
              const state = yield* STM.commit(GSet.query(set))

              // Merge with itself
              yield* STM.commit(GSet.merge(set, state))

              const sizeAfter = yield* STM.commit(GSet.size(set))

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
              yield* STM.commit(GSet.add(set, `item-${i}`))
              return yield* STM.commit(GSet.size(set))
            })
          )

          // Check that each size is >= the previous
          return sizes.every((size, i) => i === 0 || size >= sizes[i - 1]!)
        })

        const result = await Effect.runPromise(program)
        expect(result).toBe(true)
      })
    })
  })
})
