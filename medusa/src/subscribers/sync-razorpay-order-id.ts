import type { SubscriberArgs, SubscriberConfig } from "@medusajs/framework"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"

/**
 * Subscriber: sync-razorpay-order-id
 *
 * When an order is placed, extracts the Razorpay order ID
 * (e.g. order_T2yg8lqNupi3Mk) from the payment session data
 * and stores it in the Medusa order's metadata for easy
 * cross-referencing between Medusa and Razorpay dashboards.
 *
 * Metadata fields set:
 *   - razorpay_order_id:  The Razorpay order ID
 *   - razorpay_payment_ids: Array of Razorpay payment IDs (if available)
 */

export default async function syncRazorpayOrderId({
  event,
  container,
}: SubscriberArgs<{ id: string }>) {
  const logger = container.resolve("logger")
  const orderId = event.data.id

  if (!orderId) return

  try {
    const query = container.resolve(ContainerRegistrationKeys.QUERY)

    // Fetch payment session data which contains the Razorpay order info
    const { data: orders } = await query.graph({
      entity: "order",
      filters: { id: orderId },
      fields: [
        "id",
        "metadata",
        "payment_collections.payment_sessions.data",
        "payment_collections.payment_sessions.provider_id",
        "payment_collections.payments.data",
        "payment_collections.payments.provider_id",
      ],
    })

    if (!orders?.length) {
      logger.warn(`[razorpay-sync] Order ${orderId} not found`)
      return
    }

    const order = orders[0]

    // Skip if already synced
    if (order.metadata?.razorpay_order_id) {
      logger.info(
        `[razorpay-sync] Order ${orderId} already has Razorpay ID: ${order.metadata.razorpay_order_id}`
      )
      return
    }

    // Extract Razorpay order ID from payment sessions or payments
    let razorpayOrderId: string | null = null
    const razorpayPaymentIds: string[] = []

    for (const collection of order.payment_collections || []) {
      if (!collection) continue

      // Check payment sessions first
      for (const session of collection.payment_sessions || []) {
        if (!session?.provider_id?.includes("razorpay")) continue
        const data = session.data as any
        if (data?.razorpayOrder?.id) {
          razorpayOrderId = data.razorpayOrder.id
        }
        if (data?.id && String(data.id).startsWith("pay_")) {
          razorpayPaymentIds.push(data.id)
        }
      }

      // Also check captured payments
      for (const payment of collection.payments || []) {
        if (!payment?.provider_id?.includes("razorpay")) continue
        const data = payment.data as any
        if (data?.razorpayOrder?.id && !razorpayOrderId) {
          razorpayOrderId = data.razorpayOrder.id
        }
        if (data?.id && String(data.id).startsWith("pay_")) {
          if (!razorpayPaymentIds.includes(data.id)) {
            razorpayPaymentIds.push(data.id)
          }
        }
      }
    }

    if (!razorpayOrderId) {
      logger.info(
        `[razorpay-sync] Order ${orderId}: no Razorpay order ID found in payment data`
      )
      return
    }

    // Update order metadata with Razorpay IDs
    const orderModule = container.resolve(Modules.ORDER)
    await orderModule.updateOrders(orderId, {
      metadata: {
        ...(order.metadata || {}),
        razorpay_order_id: razorpayOrderId,
        ...(razorpayPaymentIds.length > 0
          ? { razorpay_payment_ids: razorpayPaymentIds }
          : {}),
      },
    })

    logger.info(
      `[razorpay-sync] ✅ Order ${orderId} → Razorpay ${razorpayOrderId}` +
        (razorpayPaymentIds.length
          ? ` (payments: ${razorpayPaymentIds.join(", ")})`
          : "")
    )
  } catch (err: any) {
    // Never let this crash order processing
    logger.error(
      `[razorpay-sync] Error for order ${orderId}: ${err?.message ?? String(err)}`
    )
  }
}

export const config: SubscriberConfig = {
  event: "order.placed",
}
