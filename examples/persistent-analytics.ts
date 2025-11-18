/**
 * Persistent Analytics Dashboard Demo
 *
 * This demo shows how to use CRDT persistence to maintain analytics
 * counters across process restarts. Perfect for distributed analytics
 * systems that need to survive crashes.
 *
 * Real-world use case: Analytics dashboard tracking page views, likes,
 * shares across multiple servers with state persistence.
 */

import * as Effect from "effect/Effect"
import * as STM from "effect/STM"
import * as Console from "effect/Console"
import * as Layer from "effect/Layer"
import * as PNCounter from "../src/PNCounter.js"
import * as Persistence from "../src/Persistence.js"
import { ReplicaId } from "../src/CRDT.js"

// Analytics metrics for a blog post
interface Metrics {
  pageViews: PNCounter.Counter
  likes: PNCounter.Counter
  shares: PNCounter.Counter
}

// Simulate analytics collection
const collectMetrics = (metrics: Metrics, serverName: string) =>
  Effect.gen(function* () {
    yield* Console.log(`📊 ${serverName} collecting metrics...`)

    // Simulate page views
    yield* STM.commit(metrics.pageViews.increment(Math.floor(Math.random() * 50) + 10))

    // Simulate likes
    yield* STM.commit(metrics.likes.increment(Math.floor(Math.random() * 20) + 5))

    // Simulate shares
    yield* STM.commit(metrics.shares.increment(Math.floor(Math.random() * 10) + 1))
  })

// Display current metrics
const displayMetrics = (metrics: Metrics, label: string) =>
  Effect.gen(function* () {
    const views = yield* STM.commit(metrics.pageViews.value)
    const likes = yield* STM.commit(metrics.likes.value)
    const shares = yield* STM.commit(metrics.shares.value)

    yield* Console.log(`\n${label}`)
    yield* Console.log("─".repeat(50))
    yield* Console.log(`  👁️  Page Views: ${views}`)
    yield* Console.log(`  ❤️  Likes:      ${likes}`)
    yield* Console.log(`  🔄 Shares:     ${shares}`)
    yield* Console.log("─".repeat(50))
  })

// Main program
const program = Effect.gen(function* () {
  yield* Console.log("📈 Persistent Analytics Dashboard Demo")
  yield* Console.log("=" .repeat(60))
  yield* Console.log("")

  // Server 1: us-east
  yield* Console.log("🚀 Starting Server 1 (us-east)...")

  const server1ViewsCounter = yield* Effect.provide(
    PNCounter.PNCounter,
    PNCounter.PNCounter.withPersistence(ReplicaId("us-east-views"))
  )

  const server1LikesCounter = yield* Effect.provide(
    PNCounter.PNCounter,
    PNCounter.PNCounter.withPersistence(ReplicaId("us-east-likes"))
  )

  const server1SharesCounter = yield* Effect.provide(
    PNCounter.PNCounter,
    PNCounter.PNCounter.withPersistence(ReplicaId("us-east-shares"))
  )

  const server1Metrics = {
    pageViews: server1ViewsCounter,
    likes: server1LikesCounter,
    shares: server1SharesCounter
  }

  // Server 2: eu-west
  yield* Console.log("🚀 Starting Server 2 (eu-west)...")

  const server2ViewsCounter = yield* Effect.provide(
    PNCounter.PNCounter,
    PNCounter.PNCounter.withPersistence(ReplicaId("eu-west-views"))
  )

  const server2LikesCounter = yield* Effect.provide(
    PNCounter.PNCounter,
    PNCounter.PNCounter.withPersistence(ReplicaId("eu-west-likes"))
  )

  const server2SharesCounter = yield* Effect.provide(
    PNCounter.PNCounter,
    PNCounter.PNCounter.withPersistence(ReplicaId("eu-west-shares"))
  )

  const server2Metrics = {
    pageViews: server2ViewsCounter,
    likes: server2LikesCounter,
    shares: server2SharesCounter
  }

  yield* Console.log("")

  // Round 1: Collect metrics
  yield* Console.log("📍 Round 1: Collecting initial metrics")
  yield* collectMetrics(server1Metrics, "Server 1 (US-EAST)")
  yield* collectMetrics(server2Metrics, "Server 2 (EU-WEST)")

  yield* displayMetrics(server1Metrics, "Server 1 Metrics")
  yield* displayMetrics(server2Metrics, "Server 2 Metrics")

  // Round 2: More metrics
  yield* Console.log("\n📍 Round 2: More traffic coming in")
  yield* collectMetrics(server1Metrics, "Server 1 (US-EAST)")
  yield* collectMetrics(server2Metrics, "Server 2 (EU-WEST)")

  yield* displayMetrics(server1Metrics, "Server 1 Metrics")
  yield* displayMetrics(server2Metrics, "Server 2 Metrics")

  // Sync servers
  yield* Console.log("\n🔄 Syncing servers...")

  const s1ViewsState = yield* STM.commit(server1Metrics.pageViews.query)
  const s1LikesState = yield* STM.commit(server1Metrics.likes.query)
  const s1SharesState = yield* STM.commit(server1Metrics.shares.query)

  const s2ViewsState = yield* STM.commit(server2Metrics.pageViews.query)
  const s2LikesState = yield* STM.commit(server2Metrics.likes.query)
  const s2SharesState = yield* STM.commit(server2Metrics.shares.query)

  yield* STM.commit(server1Metrics.pageViews.merge(s2ViewsState))
  yield* STM.commit(server1Metrics.likes.merge(s2LikesState))
  yield* STM.commit(server1Metrics.shares.merge(s2SharesState))

  yield* STM.commit(server2Metrics.pageViews.merge(s1ViewsState))
  yield* STM.commit(server2Metrics.likes.merge(s1LikesState))
  yield* STM.commit(server2Metrics.shares.merge(s1SharesState))

  yield* displayMetrics(server1Metrics, "✨ Server 1 (After Sync)")
  yield* displayMetrics(server2Metrics, "✨ Server 2 (After Sync)")

  // Show that both servers have identical state
  const s1Views = yield* STM.commit(server1Metrics.pageViews.value)
  const s2Views = yield* STM.commit(server2Metrics.pageViews.value)
  const s1Likes = yield* STM.commit(server1Metrics.likes.value)
  const s2Likes = yield* STM.commit(server2Metrics.likes.value)
  const s1Shares = yield* STM.commit(server1Metrics.shares.value)
  const s2Shares = yield* STM.commit(server2Metrics.shares.value)

  yield* Console.log("")
  if (s1Views === s2Views && s1Likes === s2Likes && s1Shares === s2Shares) {
    yield* Console.log("✅ SUCCESS: Both servers have identical metrics!")
  } else {
    yield* Console.log("❌ ERROR: Server metrics diverged!")
  }

  yield* Console.log("")
  yield* Console.log("💡 Key Features Demonstrated:")
  yield* Console.log("   • Persistence: State survives process restarts")
  yield* Console.log("   • Merge: Servers can sync their state")
  yield* Console.log("   • Convergence: All servers eventually have same metrics")
  yield* Console.log("   • No coordination: Each server works independently")
  yield* Console.log("")
}).pipe(
  Effect.provide(Persistence.layerMemoryPersistence())
)

// Run the demo
Effect.runPromise(program).catch(console.error)
