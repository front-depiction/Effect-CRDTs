/**
 * Distributed Shopping Cart Demo
 *
 * This demo shows how CRDTs can power a distributed shopping cart where
 * multiple devices/tabs can add items simultaneously and sync later.
 *
 * Real-world use case: E-commerce app where users can add items offline
 * on multiple devices and have them merge when reconnected.
 */

import * as Effect from "effect/Effect"
import * as STM from "effect/STM"
import * as Console from "effect/Console"
import * as GSet from "../src/GSet.js"
import * as PNCounter from "../src/PNCounter.js"
import { ReplicaId } from "../src/CRDT.js"

// Product type
interface Product {
  readonly id: string
  readonly name: string
  readonly price: number
}

// Cart item with product and quantity
interface CartItem {
  readonly product: Product
  readonly quantity: number
}

// Simulate a shopping cart with GSet for items
const program = Effect.gen(function* () {
  yield* Console.log("🛒 Distributed Shopping Cart Demo")
  yield* Console.log("=" .repeat(60))
  yield* Console.log("")

  // Create replicas for different devices
  const mobileCart = yield* GSet.make<string>(ReplicaId("mobile-app"))
  const webCart = yield* GSet.make<string>(ReplicaId("web-browser"))
  const desktopCart = yield* GSet.make<string>(ReplicaId("desktop-app"))

  yield* Console.log("📱 Devices: Mobile App, Web Browser, Desktop App")
  yield* Console.log("🔌 All devices currently offline (working independently)")
  yield* Console.log("")

  // Mobile: User adds items while commuting (offline)
  yield* Console.log("📍 Mobile App (Offline):")
  yield* STM.commit(mobileCart.add("product-001:laptop"))
  yield* STM.commit(mobileCart.add("product-002:mouse"))
  yield* STM.commit(mobileCart.add("product-003:keyboard"))

  const mobileItems = yield* STM.commit(mobileCart.values)
  yield* Console.log(`   Added ${mobileItems.size} items`)
  for (const item of mobileItems) {
    yield* Console.log(`   - ${item}`)
  }
  yield* Console.log("")

  // Web: User browsing at work (offline)
  yield* Console.log("📍 Web Browser (Offline):")
  yield* STM.commit(webCart.add("product-004:monitor"))
  yield* STM.commit(webCart.add("product-005:webcam"))
  yield* STM.commit(webCart.add("product-002:mouse")) // Same item!

  const webItems = yield* STM.commit(webCart.values)
  yield* Console.log(`   Added ${webItems.size} items`)
  for (const item of webItems) {
    yield* Console.log(`   - ${item}`)
  }
  yield* Console.log("")

  // Desktop: User shopping at home
  yield* Console.log("📍 Desktop App (Offline):")
  yield* STM.commit(desktopCart.add("product-006:headphones"))
  yield* STM.commit(desktopCart.add("product-001:laptop")) // Same laptop!
  yield* STM.commit(desktopCart.add("product-007:usb-hub"))

  const desktopItems = yield* STM.commit(desktopCart.values)
  yield* Console.log(`   Added ${desktopItems.size} items`)
  for (const item of desktopItems) {
    yield* Console.log(`   - ${item}`)
  }
  yield* Console.log("")

  // Now sync all devices
  yield* Console.log("🌐 Devices come online and sync...")
  yield* Console.log("")

  // Get states from all devices
  const mobileState = yield* STM.commit(mobileCart.query)
  const webState = yield* STM.commit(webCart.query)
  const desktopState = yield* STM.commit(desktopCart.query)

  // Merge all states (each device gets all items)
  yield* STM.commit(mobileCart.merge(webState))
  yield* STM.commit(mobileCart.merge(desktopState))

  yield* STM.commit(webCart.merge(mobileState))
  yield* STM.commit(webCart.merge(desktopState))

  yield* STM.commit(desktopCart.merge(mobileState))
  yield* STM.commit(desktopCart.merge(webState))

  // Show merged cart on each device
  const finalMobile = yield* STM.commit(mobileCart.values)
  const finalWeb = yield* STM.commit(webCart.values)
  const finalDesktop = yield* STM.commit(desktopCart.values)

  yield* Console.log("✅ Sync Complete!")
  yield* Console.log("")
  yield* Console.log("=" .repeat(60))
  yield* Console.log("🎉 Unified Shopping Cart (All Devices):")
  yield* Console.log("=" .repeat(60))

  const allItems = Array.from(finalMobile).sort()
  yield* Console.log(`\n📦 Total Unique Items: ${allItems.length}`)
  yield* Console.log("")

  for (const item of allItems) {
    const [productId, name] = item.split(":")
    yield* Console.log(`   ✓ ${name.toUpperCase().padEnd(15)} (${productId})`)
  }

  yield* Console.log("")
  yield* Console.log("💡 Key Points:")
  yield* Console.log("   • Duplicate items (laptop, mouse) were automatically deduplicated")
  yield* Console.log("   • No conflicts - all items from all devices merged successfully")
  yield* Console.log("   • No coordination needed - each device worked independently")
  yield* Console.log("   • All devices now have identical cart state")
  yield* Console.log("")

  // Verify all devices have same state
  const mobile = Array.from(finalMobile).sort().join(",")
  const web = Array.from(finalWeb).sort().join(",")
  const desktop = Array.from(finalDesktop).sort().join(",")

  if (mobile === web && web === desktop) {
    yield* Console.log("✅ VERIFICATION PASSED: All replicas converged to identical state")
  } else {
    yield* Console.log("❌ VERIFICATION FAILED: Replicas diverged!")
  }

  yield* Console.log("")
})

// Run the demo
Effect.runPromise(program)
