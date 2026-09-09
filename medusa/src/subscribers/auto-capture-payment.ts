import type { SubscriberArgs, SubscriberConfig } from "@medusajs/framework"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import { capturePaymentWorkflow } from "@medusajs/medusa/core-flows"

/**
 * Subscriber: auto-capture-payment
 *
 * Automatically captures authorized payments when an order is placed.
 *
 * The Razorpay plugin with auto_capture: true captures payments on
 * the gateway side, but Medusa's internal state (captured_at) may not
 * be updated. This subscriber:
 *
 * 1. Waits 5s for the Razorpay webhook to process
 * 2. Runs capturePaymentWorkflow for uncaptured payments
 * 3. If the workflow fails (payment already captured on gateway),
 *    falls back to direct Payment module capture to sync state
 *
 * The subscriber is idempotent and failure-tolerant.
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
    // Wait to let the Razorpay webhook process first
    await new Promise((resolve) => setTimeout(resolve, 5000))

    const query = container.resolve(ContainerRegistrationKeys.QUERY)

    const { data: orders } = await query.graph({
      entity: "order",
      filters: { id: orderId },
      fields: [
        "id",
        "payment_collections.payments.id",
        "payment_collections.payments.captured_at",
        "payment_collections.payments.amount",
      ],
    })

    if (!orders?.length) {
      logger.warn(`[auto-capture] Order ${orderId} not found via query`)
      return
    }

    const order = orders[0]

    // Find all uncaptured payments
    const uncapturedPayments: { id: string; amount: number }[] = []

    for (const collection of order.payment_collections || []) {
      if (!collection) continue
      for (const payment of collection.payments || []) {
        if (!payment) continue
        if (!payment.captured_at) {
          uncapturedPayments.push({
            id: payment.id,
            amount: payment.amount || 0,
          })
        }
      }
    }

    if (!uncapturedPayments.length) {
      logger.info(
        `[auto-capture] Order ${orderId}: all payments already captured ✅`
      )
      return
    }

    logger.info(
      `[auto-capture] Order ${orderId}: found ${uncapturedPayments.length} uncaptured payment(s)`
    )

    for (const { id: paymentId, amount } of uncapturedPayments) {
      // Attempt 1: Use the standard workflow
      try {
        logger.info(
          `[auto-capture] Attempt 1 — capturePaymentWorkflow for ${paymentId}...`
        )

        await capturePaymentWorkflow(container).run({
          input: {
            payment_id: paymentId,
          },
        })

        logger.info(
          `[auto-capture] ✅ Workflow captured payment ${paymentId}`
        )
        continue // Success, move to next payment
      } catch (workflowErr: any) {
        const msg = workflowErr?.message ?? String(workflowErr)
        logger.warn(
          `[auto-capture] Workflow failed for ${paymentId}: ${msg.slice(0, 120)}`
        )
      }

      // Attempt 2: Direct module capture (handles Razorpay auto-capture race)
      try {
        logger.info(
          `[auto-capture] Attempt 2 — direct Payment module capture for ${paymentId}...`
        )

        const paymentModule = container.resolve(Modules.PAYMENT)
        await paymentModule.capturePayment({
          payment_id: paymentId,
          captured_by: "auto-capture-subscriber",
          amount,
        })

        logger.info(
          `[auto-capture] ✅ Direct capture succeeded for payment ${paymentId}`
        )
      } catch (directErr: any) {
        const directMsg = directErr?.message ?? String(directErr)

        if (
          directMsg.includes("captured") ||
          directMsg.includes("already")
        ) {
          logger.info(
            `[auto-capture] Payment ${paymentId} confirmed as already captured`
          )
        } else {
          logger.error(
            `[auto-capture] ❌ Both attempts failed for ${paymentId}: ${directMsg.slice(0, 120)}`
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
