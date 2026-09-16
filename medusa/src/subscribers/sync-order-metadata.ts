import type { SubscriberArgs, SubscriberConfig } from "@medusajs/framework"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"

/**
 * Subscriber: sync-order-metadata
 *
 * Syncs important order data into order.metadata so the storefront
 * tracking page can display it without needing admin API access.
 *
 * Events handled:
 *   - order.placed → extracts Razorpay order/payment IDs
 *   - fulfillment.created → extracts tracking number, carrier, timestamps
 *   - order.fulfillment_created → backup trigger for fulfillment data
 *
 * Metadata fields set:
 *   - razorpay_order_id: The Razorpay order ID
 *   - razorpay_payment_ids: Array of Razorpay payment IDs
 *   - tracking.number: AWB / tracking number
 *   - tracking.carrier: Shipping provider name
 *   - tracking.url: Tracking URL (if available)
 *   - tracking.shipped_at: ISO timestamp when marked as shipped
 *   - tracking.delivered_at: ISO timestamp when delivered
 */

export default async function syncOrderMetadata({
  event,
  container,
}: SubscriberArgs<{ id: string; order_id?: string }>) {
  const logger = container.resolve("logger")
  const eventName = event.name

  try {
    if (eventName === "order.placed") {
      await syncRazorpayData(event.data.id, container, logger)
    } else if (
      eventName === "fulfillment.created" ||
      eventName === "order.fulfillment_created"
    ) {
      await syncFulfillmentData(event.data, container, logger)
    }
  } catch (err: any) {
    // Never let this crash order processing
    logger.error(
      `[order-metadata] Error on ${eventName}: ${err?.message ?? String(err)}`
    )
  }
}

/**
 * Sync Razorpay payment data into order metadata.
 */
async function syncRazorpayData(
  orderId: string,
  container: Record<string, any>,
  logger: any
) {
  if (!orderId) return

  const query = container.resolve(ContainerRegistrationKeys.QUERY)

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
    logger.warn(`[order-metadata] Order ${orderId} not found`)
    return
  }

  const order = orders[0]

  // Skip if already synced
  if (order.metadata?.razorpay_order_id) {
    logger.info(
      `[order-metadata] Order ${orderId} already has Razorpay ID: ${order.metadata.razorpay_order_id}`
    )
    return
  }

  // Extract Razorpay order ID from payment sessions or payments
  let razorpayOrderId: string | null = null
  const razorpayPaymentIds: string[] = []
  let paymentMethod = ""

  for (const collection of order.payment_collections || []) {
    if (!collection) continue

    for (const session of collection.payment_sessions || []) {
      if (!session?.provider_id?.includes("razorpay")) continue
      paymentMethod = "razorpay"
      const data = session.data as any
      if (data?.razorpayOrder?.id) {
        razorpayOrderId = data.razorpayOrder.id
      }
      if (data?.id && String(data.id).startsWith("pay_")) {
        razorpayPaymentIds.push(data.id)
      }
    }

    for (const payment of collection.payments || []) {
      if (!payment?.provider_id?.includes("razorpay")) continue
      paymentMethod = "razorpay"
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
      `[order-metadata] Order ${orderId}: no Razorpay order ID found in payment data`
    )
    return
  }

  const orderModule = container.resolve(Modules.ORDER)
  await orderModule.updateOrders(orderId, {
    metadata: {
      ...(order.metadata || {}),
      razorpay_order_id: razorpayOrderId,
      ...(razorpayPaymentIds.length > 0
        ? { razorpay_payment_ids: razorpayPaymentIds }
        : {}),
      ...(paymentMethod ? { payment_method: paymentMethod } : {}),
    },
  })

  logger.info(
    `[order-metadata] ✅ Order ${orderId} → Razorpay ${razorpayOrderId}` +
      (razorpayPaymentIds.length
        ? ` (payments: ${razorpayPaymentIds.join(", ")})`
        : "")
  )
}

/**
 * Sync fulfillment/tracking data into order metadata.
 * Triggered when a fulfillment is created or marked as shipped.
 */
async function syncFulfillmentData(
  eventData: { id: string; order_id?: string },
  container: Record<string, any>,
  logger: any
) {
  const fulfillmentId = eventData.id
  if (!fulfillmentId) return

  try {
    const fulfillmentService = container.resolve(Modules.FULFILLMENT)
    const fulfillment = await fulfillmentService.retrieveFulfillment(fulfillmentId, {
      relations: ["items", "labels"],
    })

    const fulfillmentAny = fulfillment as any

    // Find the order ID - try event data first, then query the link table
    let orderId = eventData.order_id || fulfillmentAny?.order_id
    if (!orderId) {
      // Query via the query graph to find the order linked to this fulfillment
      const query = container.resolve(ContainerRegistrationKeys.QUERY)
      try {
        const { data: orders } = await query.graph({
          entity: "order",
          filters: {},
          fields: ["id", "fulfillments.id"],
        })
        const matchingOrder = orders?.find((o: any) =>
          o.fulfillments?.some((f: any) => f.id === fulfillmentId)
        )
        orderId = matchingOrder?.id
      } catch {
        logger.warn(
          `[order-metadata] Could not resolve order for fulfillment ${fulfillmentId}`
        )
      }
    }

    if (!orderId) {
      logger.warn(
        `[order-metadata] Could not find order for fulfillment ${fulfillmentId}`
      )
      return
    }

    // Extract tracking data — handles both manual and Shiprocket fulfillments
    const fulfillmentData = fulfillmentAny?.data || {}
    
    const trackingNumber =
      // Shiprocket AWB number
      fulfillmentData?.awb_code ||
      fulfillmentData?.awb_number ||
      // Standard Medusa fields
      fulfillmentAny?.tracking_numbers?.[0] ||
      fulfillmentAny?.labels?.[0]?.tracking_number ||
      null

    // Shiprocket provides courier name in the data
    const shiprocketCourier = fulfillmentData?.courier_name || fulfillmentData?.courier_company_id || null

    const trackingUrl =
      // Shiprocket tracking URL
      fulfillmentData?.tracking_url ||
      // Standard Medusa fields
      fulfillmentAny?.tracking_links?.[0]?.url ||
      fulfillmentAny?.labels?.[0]?.tracking_url ||
      // Auto-generate Shiprocket tracking URL from AWB
      (trackingNumber && fulfillmentAny?.provider_id?.includes("shiprocket")
        ? `https://shiprocket.co/tracking/${trackingNumber}`
        : null)

    // Clean up carrier name
    const rawCarrier = shiprocketCourier || fulfillmentAny?.provider_id || null
    const carrier = rawCarrier
      ? rawCarrier
          .replace(/_/g, " ")
          .replace(/\b\w/g, (c: string) => c.toUpperCase())
          .replace(/^Manual Manual$/, "Standard Shipping")
          .replace(/^Pp Shiprocket Shiprocket$/, shiprocketCourier || "Shiprocket")
      : null

    const shippedAt = fulfillmentAny?.shipped_at || null
    const deliveredAt = fulfillmentAny?.delivered_at || null
    
    // Shiprocket-specific metadata
    const shiprocketOrderId = fulfillmentData?.order_id || fulfillmentData?.shiprocket_order_id || null
    const shipmentId = fulfillmentData?.shipment_id || null
    const estimatedDelivery = fulfillmentData?.etd || fulfillmentData?.estimated_delivery_date || null

    // Build tracking metadata
    const tracking: Record<string, any> = {}
    if (trackingNumber) tracking.number = trackingNumber
    if (carrier) tracking.carrier = carrier
    if (trackingUrl) tracking.url = trackingUrl
    if (shippedAt) tracking.shipped_at = new Date(shippedAt).toISOString()
    if (deliveredAt) tracking.delivered_at = new Date(deliveredAt).toISOString()
    if (shiprocketOrderId) tracking.shiprocket_order_id = shiprocketOrderId
    if (shipmentId) tracking.shipment_id = shipmentId
    if (estimatedDelivery) tracking.estimated_delivery = estimatedDelivery

    if (Object.keys(tracking).length === 0) {
      logger.info(
        `[order-metadata] Fulfillment ${fulfillmentId}: no tracking data to sync`
      )
      return
    }

    // Update order metadata, preserving existing fields
    const orderModule = container.resolve(Modules.ORDER)
    const order = await orderModule.retrieveOrder(orderId)
    const existingMetadata = (order as any)?.metadata || {}

    await orderModule.updateOrders(orderId, {
      metadata: {
        ...existingMetadata,
        tracking: {
          ...(existingMetadata.tracking || {}),
          ...tracking,
        },
      },
    })

    logger.info(
      `[order-metadata] ✅ Order ${orderId} → tracking: ${trackingNumber || "no number"}, carrier: ${carrier || "unknown"}`
    )
  } catch (err: any) {
    logger.error(
      `[order-metadata] Fulfillment sync error: ${err?.message ?? String(err)}`
    )
  }
}

export const config: SubscriberConfig = {
  event: [
    "order.placed",
    "fulfillment.created",
    "order.fulfillment_created",
  ],
}
