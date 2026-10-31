import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { Modules } from "@medusajs/framework/utils"
import {
  clearTestPricingFailures,
  getTestPricingLockout,
  isEmailAllowed,
  readTestEmailWhitelist,
  recordTestPricingFailure,
  verifyTestShopPin,
} from "../../../../../lib/test-pricing-auth"

/**
 * POST /store/carts/:id/test-pricing
 *
 * Sets all line items in a cart to ₹1 each for test orders.
 * Uses MedusaJS's is_custom_price flag so the price sticks
 * through cart recalculations.
 *
 * Body: { test_code: string, customer_email?: string }
 *
 * test_code is checked (constant-time) against the server-only env var
 * TEST_SHOP_PIN. Unset/empty TEST_SHOP_PIN => always 403 (fail closed).
 * 5 failures per IP within 10 minutes => 429 with Retry-After (in-memory,
 * per instance). The code is never logged and never stored in metadata.
 *
 * This ensures the MedusaJS order, payment, invoice, and admin
 * all show ₹1 — not the original product price.
 */
const GENERIC_FORBIDDEN = { error: "Test pricing is not available" }

function clientIp(req: MedusaRequest): string {
  return (
    (req as any).ip ||
    (req as any).socket?.remoteAddress ||
    "unknown"
  )
}

export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const cartId = req.params.id
  const { test_code, customer_email } = (req.body || {}) as {
    test_code?: string
    customer_email?: string
  }

  if (!cartId) {
    return res.status(400).json({ error: "Cart ID is required" })
  }

  // Per-IP brute-force protection (in-memory, per instance only).
  const ip = clientIp(req)
  const lockout = getTestPricingLockout(ip)
  if (lockout.locked) {
    res.setHeader("Retry-After", String(lockout.retryAfterSeconds))
    return res
      .status(429)
      .json({ error: "Too many attempts. Please try again later." })
  }

  // Server-only TEST_SHOP_PIN, timing-safe compare, fail closed when unset.
  // Email whitelist is evaluated too; both failures return the same generic
  // 403 so the response never reveals which check failed.
  const pinOk = verifyTestShopPin(test_code)
  const emailOk = isEmailAllowed(customer_email, readTestEmailWhitelist())
  if (!pinOk || !emailOk) {
    recordTestPricingFailure(ip)
    return res.status(403).json(GENERIC_FORBIDDEN)
  }
  clearTestPricingFailures(ip)

  const logger = req.scope.resolve("logger")

  try {
    const cartModule = req.scope.resolve(Modules.CART)

    // Retrieve the cart with its line items
    const cart = await cartModule.retrieveCart(cartId, {
      relations: ["items"],
    })

    if (!cart) {
      return res.status(404).json({ error: "Cart not found" })
    }

    const items = (cart as any).items || []
    if (items.length === 0) {
      return res.status(400).json({ error: "Cart has no items" })
    }

    // Update each line item's unit_price to ₹1 and mark as custom price
    const updatePromises = items.map((item: any) =>
      cartModule.updateLineItems(item.id, {
        unit_price: 1,
        is_custom_price: true,
      })
    )

    await Promise.all(updatePromises)

    // Update cart metadata to mark as test mode.
    // SECURITY: never store the code (or any value derived from it) here:
    // cart/order metadata is readable via the public store API. Any stale
    // test_code key from older versions is dropped from the spread.
    // NOTE: test_mode is only a display hint — customers can set cart
    // metadata themselves via POST /store/carts/:id, so nothing may trust it
    // for pricing/payment decisions (the ₹1 price is enforced by
    // is_custom_price line items set above, not by this flag).
    const { test_code: _staleTestCode, ...existingMetadata } =
      ((cart as any).metadata || {}) as Record<string, unknown>
    await cartModule.updateCarts(cartId, {
      metadata: {
        ...existingMetadata,
        test_mode: true,
        test_paid_amount_inr: items.reduce(
          (sum: number, item: any) => sum + (item.quantity || 1),
          0
        ),
        test_item_count: items.reduce(
          (sum: number, item: any) => sum + (item.quantity || 1),
          0
        ),
      },
    })

    logger.info(
      `[test-pricing] ✅ Cart ${cartId}: ${items.length} line items set to ₹1 each`
    )

    // Retrieve updated cart to return fresh totals
    const updatedCart = await cartModule.retrieveCart(cartId, {
      relations: ["items"],
    })

    return res.json({
      success: true,
      cart_id: cartId,
      items_updated: items.length,
      new_total: (updatedCart as any).total,
    })
  } catch (err: any) {
    logger.error(`[test-pricing] Error: ${err?.message ?? String(err)}`)
    return res.status(500).json({
      error: "Failed to apply test pricing",
      details: err?.message,
    })
  }
}
