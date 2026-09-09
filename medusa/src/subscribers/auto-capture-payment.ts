import type { SubscriberArgs, SubscriberConfig } from "@medusajs/framework"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import { capturePaymentWorkflow } from "@medusajs/medusa/core-flows"

/**
 * Subscriber: auto-capture-payment
 *
 * Automatically captures authorized payments when an order is placed.
 *
 * Flow (verified against Medusa v2 docs):
 * 1. Listen to `order.placed` event (payload: { id: string })
 * 2. Use Query API (ContainerRegistrationKeys.QUERY) to traverse:
 *    order → payment_collections → payments
 * 3. Filter for payments with status "authorized" (skip "captured", "pending", etc.)
 * 4. Run `capturePaymentWorkflow` for each authorized payment
 * 5. This workflow properly emits `payment.captured` event downstream
 *
 * Why this is needed:
 * - Razorpay's `auto_capture: true` tells the gateway to capture immediately,
 *   but Medusa's internal state may still show "authorized" until the webhook
 *   confirms capture. This subscriber ensures capture happens even if the
 *   webhook is delayed or fails.
 * - This is idempotent: if payment is already captured, it's skipped.
 *
 * Medusa v2 API patterns used:
 * - query.graph() for cross-module data traversal (Order → Payment)
 * - capturePaymentWorkflow from @medusajs/medusa/core-flows
 * - No invalid relations or cross-module eager loading
 */

export default async function autoCapturePayment({
  event,
  container,
}: SubscriberArgs<{ id: string }>) {
  const logger = container.resolve("logger")
  const orderId = event.data.id

  if (!orderId) {
    logger.warn("[auto-capture] No order ID in event data")
    return
  }

  try {
    // Wait a few seconds to let the Razorpay webhook process first.
    // The webhook's process-payment-workflow often captures the payment
    // before this subscriber runs. The delay reduces double-capture attempts.
    await new Promise((resolve) => setTimeout(resolve, 5000))

    // Step 1: Use Query API to get payments linked to this order
    const query = container.resolve(ContainerRegistrationKeys.QUERY)

    const { data: orders } = await query.graph({
      entity: "order",
      filters: { id: orderId },
      fields: [
        "id",
        "payment_collections.payments.id",
        "payment_collections.payments.captured_at",
      ],
    })

    if (!orders?.length) {
      logger.warn(`[auto-capture] Order ${orderId} not found via query`)
      return
    }

    const order = orders[0]

    // Step 2: Find all authorized (not yet captured) payments
    const authorizedPaymentIds: string[] = []

    for (const collection of order.payment_collections || []) {
      if (!collection) continue
      for (const payment of collection.payments || []) {
        if (!payment) continue
        // If captured_at is null/undefined, the payment hasn't been captured yet
        if (!payment.captured_at) {
          authorizedPaymentIds.push(payment.id)
        }
      }
    }

    if (!authorizedPaymentIds.length) {
      logger.info(
        `[auto-capture] Order ${orderId}: all payments already captured ✅`
      )
      return
    }

    // Step 3: Capture each authorized payment via the workflow
    for (const paymentId of authorizedPaymentIds) {
      try {
        logger.info(
          `[auto-capture] Capturing payment ${paymentId} for order ${orderId}...`
        )

        await capturePaymentWorkflow(container).run({
          input: {
            payment_id: paymentId,
          },
        })

        logger.info(
          `[auto-capture] ✅ Successfully captured payment ${paymentId} for order ${orderId}`
        )
      } catch (captureErr: any) {
        const msg = captureErr?.message ?? String(captureErr)

        // These errors mean the payment is already captured — not a problem
        if (
          msg.includes("captured") ||
          msg.includes("filter is not a function") ||
          msg.includes("authorized amount")
        ) {
          logger.info(
            `[auto-capture] Payment ${paymentId} appears already captured (${msg.slice(0, 80)}) — OK`
          )
        } else {
          logger.error(
            `[auto-capture] ❌ Failed to capture payment ${paymentId}: ${msg}`
          )
        }
      }
    }
  } catch (err: any) {
    // Never let capture failures crash event processing
    logger.error(
      `[auto-capture] Error processing order ${orderId}: ${err?.message ?? String(err)}`
    )
  }
}

export const config: SubscriberConfig = {
  event: "order.placed",
}
