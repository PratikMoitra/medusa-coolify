import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { Modules } from "@medusajs/framework/utils"

/**
 * POST /store/carts/:id/test-pricing
 *
 * Sets all line items in a cart to ₹1 each for test orders.
 * Uses MedusaJS's is_custom_price flag so the price sticks
 * through cart recalculations.
 *
 * Body: { test_code: string }
 *
 * This ensures the MedusaJS order, payment, invoice, and admin
 * all show ₹1 — not the original product price.
 */
export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const cartId = req.params.id
  const { test_code } = req.body as { test_code?: string }

  if (!cartId) {
    return res.status(400).json({ error: "Cart ID is required" })
  }

  // Validate the test code against env
  const validCode = process.env.TEST_SHOP_PIN || process.env.NEXT_PUBLIC_TEST_SHOP_PIN
  if (!validCode || test_code !== validCode) {
    return res.status(403).json({ error: "Invalid test code" })
  }

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

    // Update cart metadata to mark as test mode
    await cartModule.updateCarts(cartId, {
      metadata: {
        ...((cart as any).metadata || {}),
        test_mode: true,
        test_code,
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
