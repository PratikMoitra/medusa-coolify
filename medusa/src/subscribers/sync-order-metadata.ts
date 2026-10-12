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
 *   - fulfillment.canceled → logs cancellation with AWB/carrier snapshot
 *   - order.canceled → logs order cancellation
 *   - fulfillment.shipment_created → logs shipment creation with AWB
 *
 * Metadata fields set:
 *   - razorpay_order_id: The Razorpay order ID
 *   - razorpay_payment_ids: Array of Razorpay payment IDs
 *   - tracking.number: AWB / tracking number
 *   - tracking.carrier: Shipping provider name
 *   - tracking.url: Tracking URL (if available)
 *   - tracking.shipped_at: ISO timestamp when marked as shipped
 *   - tracking.delivered_at: ISO timestamp when delivered
 *   - fulfillment_log: Array of lifecycle events with timestamps
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
    } else if (eventName === "fulfillment.canceled") {
      await logFulfillmentCanceled(event.data, container, logger)
    } else if (eventName === "order.canceled") {
      await logOrderCanceled(event.data.id, container, logger)
    } else if (eventName === "fulfillment.shipment_created") {
      await logShipmentCreated(event.data, container, logger)
    }
  } catch (err: any) {
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
 * Resolve the order ID from event data or by querying fulfillment links.
 */
async function resolveOrderId(
  eventData: { id: string; order_id?: string },
  fulfillmentAny: any,
  container: Record<string, any>,
  logger: any
): Promise<string | null> {
  let orderId = eventData.order_id || fulfillmentAny?.order_id
  if (orderId) return orderId

  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  try {
    const { data: orders } = await query.graph({
      entity: "order",
      filters: {},
      fields: ["id", "fulfillments.id"],
    })
    const matchingOrder = orders?.find((o: any) =>
      o.fulfillments?.some((f: any) => f.id === eventData.id)
    )
    orderId = matchingOrder?.id
  } catch {
    logger.warn(
      `[order-metadata] Could not resolve order for fulfillment ${eventData.id}`
    )
  }

  if (!orderId) {
    logger.warn(
      `[order-metadata] Could not find order for fulfillment ${eventData.id}`
    )
  }
  return orderId || null
}

/**
 * Extract tracking data from a fulfillment object.
 */
function extractTrackingData(fulfillmentAny: any) {
  const fulfillmentData = fulfillmentAny?.data || {}

  const trackingNumber =
    fulfillmentData?.awb ||
    fulfillmentData?.awb_code ||
    fulfillmentData?.awb_number ||
    fulfillmentAny?.tracking_numbers?.[0] ||
    fulfillmentAny?.labels?.[0]?.tracking_number ||
    null

  const shiprocketCourier = fulfillmentData?.courier_name || null
  const courierCompanyId = fulfillmentData?.courier_company_id || null

  const trackingUrl =
    fulfillmentData?.tracking_url ||
    fulfillmentAny?.tracking_links?.[0]?.url ||
    fulfillmentAny?.labels?.[0]?.tracking_url ||
    (trackingNumber && fulfillmentAny?.provider_id?.includes("shiprocket")
      ? `https://shiprocket.co/tracking/${trackingNumber}`
      : null)

  const rawCarrier = shiprocketCourier || fulfillmentAny?.provider_id || null
  const carrier = rawCarrier
    ? rawCarrier
        .replace(/_/g, " ")
        .replace(/\b\w/g, (c: string) => c.toUpperCase())
        .replace(/^Manual Manual$/, "Standard Shipping")
        .replace(/^Pp Shiprocket Shiprocket$/, shiprocketCourier || "Shiprocket")
    : null

  const shiprocketOrderId = fulfillmentData?.order_id || fulfillmentData?.shiprocket_order_id || null
  const shipmentId = fulfillmentData?.shipment_id || null
  const estimatedDelivery = fulfillmentData?.etd || fulfillmentData?.estimated_delivery_date || null
  const labelUrl = fulfillmentAny?.labels?.[0]?.label_url || fulfillmentData?.label_url || null
  const channelOrderId = fulfillmentData?.channel_order_id || null

  return {
    trackingNumber,
    carrier,
    trackingUrl,
    shiprocketCourier,
    courierCompanyId,
    shiprocketOrderId,
    shipmentId,
    estimatedDelivery,
    labelUrl,
    channelOrderId,
    shippedAt: fulfillmentAny?.shipped_at || null,
    deliveredAt: fulfillmentAny?.delivered_at || null,
    statusCode: fulfillmentData?.status_code || null,
    status: fulfillmentData?.status || null,
  }
}

/**
 * Sync fulfillment/tracking data into order metadata.
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
    const orderId = await resolveOrderId(eventData, fulfillmentAny, container, logger)
    if (!orderId) return

    const td = extractTrackingData(fulfillmentAny)

    // Build tracking metadata
    const tracking: Record<string, any> = {}
    if (td.trackingNumber) tracking.number = td.trackingNumber
    if (td.carrier) tracking.carrier = td.carrier
    if (td.trackingUrl) tracking.url = td.trackingUrl
    if (td.shippedAt) tracking.shipped_at = new Date(td.shippedAt).toISOString()
    if (td.deliveredAt) tracking.delivered_at = new Date(td.deliveredAt).toISOString()
    if (td.shiprocketOrderId) tracking.shiprocket_order_id = td.shiprocketOrderId
    if (td.shipmentId) tracking.shipment_id = td.shipmentId
    if (td.estimatedDelivery) tracking.estimated_delivery = td.estimatedDelivery
    if (td.courierCompanyId) tracking.courier_company_id = td.courierCompanyId
    if (td.labelUrl) tracking.label_url = td.labelUrl

    // Build log entry
    const logEntry: Record<string, any> = {
      event: "fulfillment_created",
      timestamp: new Date().toISOString(),
      fulfillment_id: fulfillmentId,
      provider: fulfillmentAny?.provider_id || null,
    }
    if (td.trackingNumber) logEntry.awb = td.trackingNumber
    if (td.carrier) logEntry.carrier = td.carrier
    if (td.trackingUrl) logEntry.tracking_url = td.trackingUrl
    if (td.shiprocketOrderId) logEntry.shiprocket_order_id = td.shiprocketOrderId
    if (td.shipmentId) logEntry.shipment_id = td.shipmentId
    if (td.courierCompanyId) logEntry.courier_company_id = td.courierCompanyId
    if (td.labelUrl) logEntry.label_url = td.labelUrl
    if (td.estimatedDelivery) logEntry.estimated_delivery = td.estimatedDelivery
    if (td.channelOrderId) logEntry.channel_order_id = td.channelOrderId

    // Update order metadata
    const orderModule = container.resolve(Modules.ORDER)
    const order = await orderModule.retrieveOrder(orderId)
    const existingMetadata = (order as any)?.metadata || {}
    const existingLog = Array.isArray(existingMetadata.fulfillment_log)
      ? existingMetadata.fulfillment_log
      : []

    const metadataUpdate: Record<string, any> = {
      ...existingMetadata,
      fulfillment_log: [...existingLog, logEntry],
    }

    if (Object.keys(tracking).length > 0) {
      metadataUpdate.tracking = {
        ...(existingMetadata.tracking || {}),
        ...tracking,
      }
    }

    await orderModule.updateOrders(orderId, { metadata: metadataUpdate })

    logger.info(
      `[order-metadata] ✅ Order ${orderId} → tracking: ${td.trackingNumber || "no number"}, carrier: ${td.carrier || "unknown"}`
    )
  } catch (err: any) {
    logger.error(
      `[order-metadata] Fulfillment sync error: ${err?.message ?? String(err)}`
    )
  }
}

/**
 * Log fulfillment cancellation — captures AWB, carrier, Shiprocket details.
 */
async function logFulfillmentCanceled(
  eventData: { id: string; order_id?: string },
  container: Record<string, any>,
  logger: any
) {
  const fulfillmentId = eventData.id
  if (!fulfillmentId) return

  try {
    const fulfillmentService = container.resolve(Modules.FULFILLMENT)
    let fulfillmentAny: any = {}
    try {
      const ful = await fulfillmentService.retrieveFulfillment(fulfillmentId, {
        relations: ["items", "labels"],
      })
      fulfillmentAny = ful as any
    } catch {
      logger.info(`[order-metadata] Fulfillment ${fulfillmentId} already deleted, logging with limited data`)
    }

    const orderId = await resolveOrderId(eventData, fulfillmentAny, container, logger)
    if (!orderId) return

    const td = extractTrackingData(fulfillmentAny)

    const logEntry: Record<string, any> = {
      event: "fulfillment_canceled",
      timestamp: new Date().toISOString(),
      fulfillment_id: fulfillmentId,
      canceled_at: fulfillmentAny?.canceled_at || new Date().toISOString(),
      provider: fulfillmentAny?.provider_id || null,
      awb: td.trackingNumber,
      carrier: td.carrier,
      tracking_url: td.trackingUrl,
      shiprocket_order_id: td.shiprocketOrderId,
      shipment_id: td.shipmentId,
      shiprocket_status: td.status,
      shiprocket_status_code: td.statusCode,
      channel_order_id: td.channelOrderId,
    }

    const orderModule = container.resolve(Modules.ORDER)
    const order = await orderModule.retrieveOrder(orderId)
    const existingMetadata = (order as any)?.metadata || {}
    const existingLog = Array.isArray(existingMetadata.fulfillment_log)
      ? existingMetadata.fulfillment_log
      : []

    await orderModule.updateOrders(orderId, {
      metadata: {
        ...existingMetadata,
        tracking: {
          ...(existingMetadata.tracking || {}),
          canceled: true,
          canceled_at: new Date().toISOString(),
          canceled_awb: td.trackingNumber,
          canceled_carrier: td.carrier,
        },
        fulfillment_log: [...existingLog, logEntry],
      },
    })

    logger.info(
      `[order-metadata] ⚠️ Order ${orderId} → fulfillment ${fulfillmentId} CANCELED` +
      ` (AWB: ${td.trackingNumber || "none"}, carrier: ${td.carrier || "unknown"})`
    )
  } catch (err: any) {
    logger.error(
      `[order-metadata] Fulfillment cancel log error: ${err?.message ?? String(err)}`
    )
  }
}

/**
 * Log order cancellation.
 */
async function logOrderCanceled(
  orderId: string,
  container: Record<string, any>,
  logger: any
) {
  if (!orderId) return

  try {
    const orderModule = container.resolve(Modules.ORDER)
    const order = await orderModule.retrieveOrder(orderId)
    const existingMetadata = (order as any)?.metadata || {}
    const existingLog = Array.isArray(existingMetadata.fulfillment_log)
      ? existingMetadata.fulfillment_log
      : []

    const logEntry = {
      event: "order_canceled",
      timestamp: new Date().toISOString(),
      order_id: orderId,
      canceled_at: (order as any)?.canceled_at || new Date().toISOString(),
    }

    await orderModule.updateOrders(orderId, {
      metadata: {
        ...existingMetadata,
        order_canceled_at: new Date().toISOString(),
        fulfillment_log: [...existingLog, logEntry],
      },
    })

    logger.info(`[order-metadata] ❌ Order ${orderId} CANCELED`)
  } catch (err: any) {
    logger.error(
      `[order-metadata] Order cancel log error: ${err?.message ?? String(err)}`
    )
  }
}

/**
 * Log shipment creation (when AWB is assigned or manifest is generated).
 */
async function logShipmentCreated(
  eventData: { id: string; order_id?: string },
  container: Record<string, any>,
  logger: any
) {
  const fulfillmentId = eventData.id
  if (!fulfillmentId) return

  try {
    const fulfillmentService = container.resolve(Modules.FULFILLMENT)
    const fulfillment = await fulfillmentService.retrieveFulfillment(fulfillmentId, {
      relations: ["labels"],
    })
    const fulfillmentAny = fulfillment as any
    const orderId = await resolveOrderId(eventData, fulfillmentAny, container, logger)
    if (!orderId) return

    const td = extractTrackingData(fulfillmentAny)

    const logEntry: Record<string, any> = {
      event: "shipment_created",
      timestamp: new Date().toISOString(),
      fulfillment_id: fulfillmentId,
      awb: td.trackingNumber,
      carrier: td.carrier,
      tracking_url: td.trackingUrl,
      label_url: td.labelUrl,
      shiprocket_order_id: td.shiprocketOrderId,
      shipment_id: td.shipmentId,
    }

    const orderModule = container.resolve(Modules.ORDER)
    const order = await orderModule.retrieveOrder(orderId)
    const existingMetadata = (order as any)?.metadata || {}
    const existingLog = Array.isArray(existingMetadata.fulfillment_log)
      ? existingMetadata.fulfillment_log
      : []

    await orderModule.updateOrders(orderId, {
      metadata: {
        ...existingMetadata,
        fulfillment_log: [...existingLog, logEntry],
      },
    })

    logger.info(
      `[order-metadata] 📦 Order ${orderId} → shipment created (AWB: ${td.trackingNumber || "pending"})`
    )
  } catch (err: any) {
    logger.error(
      `[order-metadata] Shipment log error: ${err?.message ?? String(err)}`
    )
  }
}

export const config: SubscriberConfig = {
  event: [
    "order.placed",
    "fulfillment.created",
    "order.fulfillment_created",
    "fulfillment.canceled",
    "order.canceled",
    "fulfillment.shipment_created",
  ],
}
