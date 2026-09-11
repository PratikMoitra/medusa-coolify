import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

/**
 * GET /tracking/:id
 *
 * Public endpoint — no authentication or publishable API key required.
 * This route lives OUTSIDE /store/ and /admin/ so Medusa does not
 * enforce any key/auth middleware.
 *
 * Returns order tracking data for the storefront tracking page.
 * The order UUID in the URL acts as a secret (unguessable).
 */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const orderId = req.params.id

  if (!orderId) {
    return res.status(400).json({ error: "Order ID is required" })
  }

  try {
    const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)

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
        "items.id",
        "items.title",
        "items.quantity",
        "items.unit_price",
        "items.thumbnail",
        "items.variant_title",
        "items.product_title",
        "shipping_address.first_name",
        "shipping_address.last_name",
        "shipping_address.address_1",
        "shipping_address.address_2",
        "shipping_address.city",
        "shipping_address.province",
        "shipping_address.postal_code",
        "shipping_address.country_code",
        "shipping_address.phone",
        "fulfillments.id",
        "fulfillments.created_at",
        "fulfillments.canceled_at",
        "fulfillments.data",
        "fulfillments.provider_id",
        "sales_channel.id",
        "sales_channel.name",
        "payment_collections.status",
        "payment_collections.payments.amount",
        "payment_collections.payments.provider_id",
        "payment_collections.payments.created_at",
      ],
    })

    if (!orders?.length) {
      return res.status(404).json({ error: "Order not found" })
    }

    const order = orders[0] as any
    const metadata = order.metadata || {}
    const trackingMeta = metadata.tracking || {}

    const timeline = buildTimeline(order, trackingMeta)
    const payment = extractPaymentInfo(order, metadata)

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

    const fulfillmentNotes = extractFulfillmentNotes(order)

    const items = (order.items || []).map((item: any) => ({
      title: item.product_title || item.title,
      variant_title: item.variant_title,
      quantity: item.quantity,
      unit_price: item.unit_price,
      thumbnail: item.thumbnail,
    }))

    const shippingAddress = order.shipping_address
      ? {
          first_name: order.shipping_address.first_name,
          city: order.shipping_address.city,
          province: order.shipping_address.province,
          postal_code: order.shipping_address.postal_code,
          country_code: order.shipping_address.country_code,
        }
      : null

    const refunds: any[] = []

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

  timeline.push({
    event: "Order Placed",
    date: order.created_at,
    status: "completed",
    detail: `Order #${order.display_id}`,
  })

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
    timeline.push({ event: "Processing", date: null, status: "cancelled" })
  } else if (paymentCaptured) {
    timeline.push({
      event: "Processing",
      date: null,
      status: "current",
      detail: "Your order is being prepared",
    })
  } else {
    timeline.push({ event: "Processing", date: null, status: "pending" })
  }

  const shippedAt = trackingMeta.shipped_at || fulfillment?.shipped_at
  if (shippedAt) {
    timeline.push({
      event: "Shipped",
      date: shippedAt,
      status: "completed",
      detail: trackingMeta.carrier ? `Via ${trackingMeta.carrier}` : "Package dispatched",
    })
  } else if (hasFulfillment && trackingMeta.number) {
    timeline.push({
      event: "Shipped",
      date: null,
      status: "current",
      detail: trackingMeta.carrier ? `Via ${trackingMeta.carrier}` : "Awaiting pickup",
    })
  } else {
    timeline.push({
      event: "Shipped",
      date: null,
      status: order.status === "canceled" ? "cancelled" : "pending",
    })
  }

  if (shippedAt && !trackingMeta.delivered_at) {
    timeline.push({
      event: "Out for Delivery",
      date: null,
      status: "current",
      detail: trackingMeta.estimated_delivery ? `Expected by ${trackingMeta.estimated_delivery}` : undefined,
    })
  } else if (trackingMeta.delivered_at) {
    timeline.push({ event: "Out for Delivery", date: null, status: "completed" })
  } else {
    timeline.push({
      event: "Out for Delivery",
      date: null,
      status: order.status === "canceled" ? "cancelled" : "pending",
    })
  }

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
      detail: trackingMeta.estimated_delivery ? `Expected by ${trackingMeta.estimated_delivery}` : undefined,
    })
  }

  return timeline
}

function extractPaymentInfo(order: any, metadata: Record<string, any>) {
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

function extractFulfillmentNotes(order: any): string[] {
  const notes: string[] = []
  for (const fulfillment of order.fulfillments || []) {
    const data = fulfillment.data || {}
    if (data.notes) notes.push(data.notes)
    if (data.internal_notes) notes.push(data.internal_notes)
    if (data.customer_notes) notes.push(data.customer_notes)
  }
  if (order.metadata?.fulfillment_notes) {
    if (Array.isArray(order.metadata.fulfillment_notes)) {
      notes.push(...order.metadata.fulfillment_notes)
    } else {
      notes.push(order.metadata.fulfillment_notes)
    }
  }
  return notes.filter(Boolean)
}
