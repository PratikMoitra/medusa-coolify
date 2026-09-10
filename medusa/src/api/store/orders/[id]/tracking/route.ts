import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"

/**
 * GET /store/orders/:id/tracking
 *
 * Public endpoint — no authentication required.
 * Returns order tracking data for the storefront tracking page.
 * The order UUID in the URL acts as a secret (unguessable).
 *
 * Response includes:
 *   - Order summary (items, dates, status)
 *   - Payment info (Razorpay IDs, method, amounts)
 *   - Tracking data (AWB, carrier, URL, timestamps)
 *   - Timeline (ordered → payment → processing → shipped → delivered)
 *   - Shipping address
 *   - Fulfillment notes
 *   - Refund history
 *   - Brand info (sales channel for theming)
 */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const orderId = req.params.id

  if (!orderId) {
    return res.status(400).json({ error: "Order ID is required" })
  }

  try {
    const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)

    // Fetch the order with all related data
    const { data: orders } = await query.graph({
      entity: "order",
      filters: { id: orderId },
      fields: [
        "id",
        "display_id",
        "status",
        "created_at",
        "updated_at",
        "metadata",
        "currency_code",
        "total",
        "subtotal",
        "shipping_total",
        "tax_total",
        "discount_total",
        // Items
        "items.id",
        "items.title",
        "items.quantity",
        "items.unit_price",
        "items.thumbnail",
        "items.variant_title",
        "items.product_title",
        // Shipping address
        "shipping_address.first_name",
        "shipping_address.last_name",
        "shipping_address.address_1",
        "shipping_address.address_2",
        "shipping_address.city",
        "shipping_address.province",
        "shipping_address.postal_code",
        "shipping_address.country_code",
        "shipping_address.phone",
        // Fulfillments
        "fulfillments.id",
        "fulfillments.created_at",
        "fulfillments.shipped_at",
        "fulfillments.delivered_at",
        "fulfillments.canceled_at",
        "fulfillments.data",
        "fulfillments.provider_id",
        "fulfillments.tracking_numbers",
        "fulfillments.labels",
        // Sales channel (for brand theming)
        "sales_channel.id",
        "sales_channel.name",
        // Payment
        "payment_collections.status",
        "payment_collections.payments.amount",
        "payment_collections.payments.provider_id",
        "payment_collections.payments.created_at",
        // Refunds
        "refunds.id",
        "refunds.amount",
        "refunds.reason",
        "refunds.note",
        "refunds.created_at",
      ],
    })

    if (!orders?.length) {
      return res.status(404).json({ error: "Order not found" })
    }

    const order = orders[0] as any
    const metadata = order.metadata || {}
    const trackingMeta = metadata.tracking || {}

    // Build timeline from actual order events
    const timeline = buildTimeline(order, trackingMeta)

    // Extract payment info
    const payment = extractPaymentInfo(order, metadata)

    // Extract tracking info
    const tracking = {
      number: trackingMeta.number || null,
      carrier: trackingMeta.carrier || null,
      url: trackingMeta.url || null,
      shipped_at: trackingMeta.shipped_at || null,
      delivered_at: trackingMeta.delivered_at || null,
      estimated_delivery: trackingMeta.estimated_delivery || null,
      shiprocket_order_id: trackingMeta.shiprocket_order_id || null,
      shipment_id: trackingMeta.shipment_id || null,
    }

    // Extract fulfillment notes
    const fulfillmentNotes = extractFulfillmentNotes(order)

    // Extract items with clean structure
    const items = (order.items || []).map((item: any) => ({
      title: item.product_title || item.title,
      variant_title: item.variant_title,
      quantity: item.quantity,
      unit_price: item.unit_price,
      thumbnail: item.thumbnail,
    }))

    // Extract shipping address (hide full address for privacy, show city/state)
    const shippingAddress = order.shipping_address
      ? {
          first_name: order.shipping_address.first_name,
          city: order.shipping_address.city,
          province: order.shipping_address.province,
          postal_code: order.shipping_address.postal_code,
          country_code: order.shipping_address.country_code,
        }
      : null

    // Extract refund info
    const refunds = (order.refunds || []).map((refund: any) => ({
      amount: refund.amount,
      reason: refund.reason,
      note: refund.note,
      created_at: refund.created_at,
    }))

    // Brand info from sales channel
    const brand = {
      name: order.sales_channel?.name || "Store",
      sales_channel_id: order.sales_channel?.id || null,
    }

    return res.json({
      order: {
        id: order.id,
        display_id: order.display_id,
        status: order.status,
        created_at: order.created_at,
        currency_code: order.currency_code,
        total: order.total,
        subtotal: order.subtotal,
        shipping_total: order.shipping_total,
        tax_total: order.tax_total,
        discount_total: order.discount_total,
        items,
        shipping_address: shippingAddress,
      },
      payment,
      tracking,
      timeline,
      fulfillment_notes: fulfillmentNotes,
      refunds,
      brand,
    })
  } catch (err: any) {
    const logger = req.scope.resolve("logger")
    logger.error(
      `[tracking-api] Error fetching order ${orderId}: ${err?.message ?? String(err)}`
    )
    return res.status(500).json({ error: "Internal server error" })
  }
}

/**
 * Build a timeline of order events for the tracking page stepper.
 */
function buildTimeline(
  order: any,
  trackingMeta: Record<string, any>
): Array<{ event: string; date: string | null; status: string; detail?: string }> {
  const timeline: Array<{
    event: string
    date: string | null
    status: string
    detail?: string
  }> = []

  // 1. Order Placed
  timeline.push({
    event: "Order Placed",
    date: order.created_at,
    status: "completed",
    detail: `Order #${order.display_id}`,
  })

  // 2. Payment Confirmed
  const paymentCaptured =
    order.payment_collections?.some((pc: any) => pc.status === "captured") ||
    !!order.metadata?.razorpay_order_id

  if (paymentCaptured) {
    const paymentDate =
      order.payment_collections?.[0]?.payments?.[0]?.created_at || order.created_at
    timeline.push({
      event: "Payment Confirmed",
      date: paymentDate,
      status: "completed",
      detail: order.metadata?.payment_method === "razorpay" ? "Paid via Razorpay" : "Payment received",
    })
  } else {
    timeline.push({
      event: "Payment Confirmation",
      date: null,
      status: order.status === "canceled" ? "cancelled" : "pending",
    })
  }

  // 3. Processing / Fulfillment Created
  const fulfillment = order.fulfillments?.[0]
  const hasFulfillment = !!fulfillment && !fulfillment.canceled_at

  if (hasFulfillment) {
    timeline.push({
      event: "Processing Started",
      date: fulfillment.created_at,
      status: "completed",
      detail: "Your order is being prepared",
    })
  } else if (order.status === "canceled") {
    timeline.push({
      event: "Processing",
      date: null,
      status: "cancelled",
    })
  } else if (paymentCaptured) {
    timeline.push({
      event: "Processing",
      date: null,
      status: "current",
      detail: "Your order is being prepared",
    })
  } else {
    timeline.push({
      event: "Processing",
      date: null,
      status: "pending",
    })
  }

  // 4. Shipped
  const shippedAt = trackingMeta.shipped_at || fulfillment?.shipped_at
  if (shippedAt) {
    timeline.push({
      event: "Shipped",
      date: shippedAt,
      status: "completed",
      detail: trackingMeta.carrier
        ? `Via ${trackingMeta.carrier}`
        : "Package dispatched",
    })
  } else if (hasFulfillment && trackingMeta.number) {
    // Has AWB but no shipped_at — in transit
    timeline.push({
      event: "Shipped",
      date: null,
      status: "current",
      detail: trackingMeta.carrier
        ? `Via ${trackingMeta.carrier}`
        : "Awaiting pickup",
    })
  } else {
    timeline.push({
      event: "Shipped",
      date: null,
      status: order.status === "canceled" ? "cancelled" : "pending",
    })
  }

  // 5. Out for Delivery (only if shipped)
  if (shippedAt && !trackingMeta.delivered_at) {
    timeline.push({
      event: "Out for Delivery",
      date: null,
      status: "current",
      detail: trackingMeta.estimated_delivery
        ? `Expected by ${trackingMeta.estimated_delivery}`
        : undefined,
    })
  } else if (trackingMeta.delivered_at) {
    timeline.push({
      event: "Out for Delivery",
      date: null, // We typically don't get exact OFD time
      status: "completed",
    })
  } else {
    timeline.push({
      event: "Out for Delivery",
      date: null,
      status: order.status === "canceled" ? "cancelled" : "pending",
    })
  }

  // 6. Delivered
  if (trackingMeta.delivered_at) {
    timeline.push({
      event: "Delivered",
      date: trackingMeta.delivered_at,
      status: "completed",
      detail: "Package delivered successfully",
    })
  } else {
    timeline.push({
      event: "Delivered",
      date: null,
      status: order.status === "canceled" ? "cancelled" : "pending",
      detail: trackingMeta.estimated_delivery
        ? `Expected by ${trackingMeta.estimated_delivery}`
        : undefined,
    })
  }

  return timeline
}

/**
 * Extract payment information from order data and metadata.
 */
function extractPaymentInfo(
  order: any,
  metadata: Record<string, any>
): {
  status: string
  method: string
  razorpay_order_id: string | null
  razorpay_payment_ids: string[]
  amount: number | null
  paid_at: string | null
} {
  const paymentCollection = order.payment_collections?.[0]
  const payment = paymentCollection?.payments?.[0]

  return {
    status: paymentCollection?.status || "pending",
    method: metadata.payment_method || payment?.provider_id || "unknown",
    razorpay_order_id: metadata.razorpay_order_id || null,
    razorpay_payment_ids: metadata.razorpay_payment_ids || [],
    amount: payment?.amount || order.total,
    paid_at: payment?.created_at || null,
  }
}

/**
 * Extract fulfillment notes from order fulfillments.
 */
function extractFulfillmentNotes(order: any): string[] {
  const notes: string[] = []

  for (const fulfillment of order.fulfillments || []) {
    const data = fulfillment.data || {}
    // Check common note fields
    if (data.notes) notes.push(data.notes)
    if (data.internal_notes) notes.push(data.internal_notes)
    if (data.customer_notes) notes.push(data.customer_notes)
  }

  // Also check order-level metadata for notes
  if (order.metadata?.fulfillment_notes) {
    if (Array.isArray(order.metadata.fulfillment_notes)) {
      notes.push(...order.metadata.fulfillment_notes)
    } else {
      notes.push(order.metadata.fulfillment_notes)
    }
  }

  return notes.filter(Boolean)
}
