import type { MedusaContainer } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

/**
 * R1: Reconcile orphaned Razorpay payments.
 *
 * Runs every 10 minutes. Finds carts that have a payment session with
 * status "authorized" but were never completed into an order (e.g.,
 * the customer's browser crashed after Razorpay captured the payment
 * but before the storefront called /store/carts/:id/complete).
 *
 * For each orphaned cart:
 * 1. Attempts to complete it via Medusa's completeCartWorkflow
 * 2. Logs the result for manual review if completion fails
 *
 * This is a safety net — the storefront retry loop handles most cases,
 * but browser crashes, network drops, or mobile backgrounding can
 * still leave payments captured without orders.
 */

export default async function reconcileOrphanedPayments(
  container: MedusaContainer
) {
  const logger = container.resolve("logger") as {
    info: (msg: string) => void
    warn: (msg: string) => void
    error: (msg: string) => void
  }

  try {
    const query = container.resolve(ContainerRegistrationKeys.QUERY)

    // Find carts that have payment collections with authorized/captured payments
    // but haven't been converted to orders yet.
    // We look at carts updated between 10 minutes and 24 hours ago
    // (too recent = might still be completing; too old = already stale)
    const now = new Date()
    const tenMinutesAgo = new Date(now.getTime() - 10 * 60 * 1000)
    const twentyFourHoursAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000)

    const { data: carts } = await query.graph({
      entity: "cart",
      filters: {
        completed_at: null as any, // Not completed
        updated_at: {
          $gte: twentyFourHoursAgo.toISOString(),
          $lte: tenMinutesAgo.toISOString(),
        },
      },
      fields: [
        "id",
        "updated_at",
        "payment_collection.id",
        "payment_collection.status",
        "payment_collection.payment_sessions.id",
        "payment_collection.payment_sessions.status",
        "payment_collection.payment_sessions.provider_id",
        "payment_collection.payment_sessions.data",
      ],
    })

    if (!carts?.length) {
      return // No orphaned carts — normal case
    }

    // Filter to carts where the payment session is authorized (Razorpay captured)
    const orphanedCarts = carts.filter((cart: any) => {
      const session = cart.payment_collection?.payment_sessions?.[0]
      if (!session) return false

      // Check if this is a Razorpay payment that was authorized
      const isRazorpay = session.provider_id?.includes("razorpay")
      const isAuthorized = session.status === "authorized"
      const isPending = session.status === "pending" && session.data?.status === "paid"

      return isRazorpay && (isAuthorized || isPending)
    })

    if (!orphanedCarts.length) {
      return
    }

    logger.info(
      `[reconcile-payments] Found ${orphanedCarts.length} orphaned cart(s) with captured Razorpay payments`
    )

    // Import the workflow dynamically to avoid circular deps
    const { completeCartWorkflow } = await import(
      "@medusajs/medusa/core-flows"
    )

    for (const cart of orphanedCarts) {
      const cartId = (cart as any).id
      const updatedAt = (cart as any).updated_at

      try {
        logger.info(
          `[reconcile-payments] Attempting to complete cart ${cartId} (updated: ${updatedAt})`
        )

        await completeCartWorkflow(container).run({
          input: { id: cartId },
        })

        logger.info(
          `[reconcile-payments] ✅ Successfully recovered order from cart ${cartId}`
        )
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err)

        // If the cart is already completed or the payment is invalid, just log
        if (
          msg.includes("already completed") ||
          msg.includes("already exists") ||
          msg.includes("not found")
        ) {
          logger.info(
            `[reconcile-payments] Cart ${cartId} already resolved: ${msg.slice(0, 100)}`
          )
        } else {
          // Genuine failure — log for manual review
          logger.error(
            `[reconcile-payments] ❌ Failed to recover cart ${cartId}: ${msg.slice(0, 200)}`
          )
        }
      }
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    logger.error(`[reconcile-payments] Job error: ${msg}`)
  }
}

export const config = {
  name: "reconcile-orphaned-payments",
  schedule: "*/10 * * * *", // Every 10 minutes
}
