import type { SubscriberArgs, SubscriberConfig } from "@medusajs/framework"
import { Modules } from "@medusajs/framework/utils"
import { sendTelegramMessage, escapeHtml } from "./telegram"

/**
 * Subscriber: telegram-notifier
 *
 * Sends real-time admin alerts to a Telegram channel for key order events.
 * Runs in parallel with email-notifications and n8n-event-forwarder.
 *
 * Events:
 *   - order.placed          → 🛒 New Order
 *   - fulfillment.created   → 📦 Shipped
 *   - fulfillment.canceled  → ❌ Fulfillment Cancelled
 *   - order.canceled        → 🚫 Order Cancelled
 *   - order.refund_created  → 💸 Refund Processed
 *
 * Never throws — failures are logged but don't block Medusa event flow.
 */

function formatINR(amount: number): string {
  return `₹${amount.toLocaleString("en-IN")}`
}

function formatTime(date?: Date | string): string {
  const d = date ? new Date(date) : new Date()
  return d.toLocaleString("en-IN", {
    timeZone: "Asia/Kolkata",
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  })
}

export default async function telegramNotifier({
  event,
  container,
}: SubscriberArgs<Record<string, any>>) {
  const logger = container.resolve("logger")
  const eventName = (event as any)?.name ?? "unknown"
  const data = event?.data as Record<string, any> | undefined

  if (!data?.id) return

  if (!process.env.TELEGRAM_BOT_TOKEN || !process.env.TELEGRAM_CHAT_ID) return

  try {
    let message = ""

    switch (eventName) {
      // ── New Order ──
      case "order.placed": {
        const orderService = container.resolve(Modules.ORDER)
        const order = await orderService.retrieveOrder(data.id, {
          relations: ["items", "shipping_address", "summary"],
        })

        const invoice = String(order.metadata?.invoice_number || `#${order.display_id}`)
        const name = order.shipping_address
          ? `${order.shipping_address.first_name || ""} ${order.shipping_address.last_name || ""}`.trim()
          : "Unknown"
        const city = order.shipping_address?.city || ""
        const state = order.shipping_address?.province || ""
        const pin = order.shipping_address?.postal_code || ""
        const phone = order.shipping_address?.phone || ""
        const email = order.email || ""

        const subtotal = Number(order.summary?.original_order_total
          ?? order.summary?.current_order_total
          ?? order.items?.reduce((s: number, i: any) => s + (Number(i.unit_price) * i.quantity), 0)
          ?? 0)
        const shipping = Number((order.summary as any)?.shipping_total ?? 0)
        const total = Number(order.summary?.current_order_total ?? subtotal + shipping)

        const itemLines = (order.items || [])
          .map((i: any) => {
            const title = escapeHtml(i.title || i.product_title || "Item")
            const variant = i.variant_title ? ` (${escapeHtml(i.variant_title)})` : ""
            return `  • ${title}${variant} × ${i.quantity} — ${formatINR(i.unit_price)}`
          })
          .join("\n")

        message = [
          `🛒 <b>New Order — ChamkileyStore</b>`,
          ``,
          `📋 Invoice: <code>${escapeHtml(String(invoice))}</code>`,
          `💰 Total: <b>${formatINR(total)}</b>${shipping > 0 ? ` (${formatINR(subtotal)} + ${formatINR(shipping)} shipping)` : ` (FREE shipping)`}`,
          `👤 Customer: ${escapeHtml(name)}`,
          email ? `📧 ${escapeHtml(email)}` : null,
          phone ? `📱 ${escapeHtml(phone)}` : null,
          ``,
          city ? `📍 ${escapeHtml(city)}${state ? `, ${escapeHtml(state)}` : ""}${pin ? ` ${escapeHtml(pin)}` : ""}` : null,
          ``,
          `🛍 Items:`,
          itemLines,
          ``,
          `🕐 ${formatTime(order.created_at)}`,
        ]
          .filter((l) => l !== null)
          .join("\n")

        break
      }

      // ── Fulfillment Created (Shipped) ──
      case "fulfillment.created": {
        const fulfillmentService = container.resolve(Modules.FULFILLMENT)
        let fulfillment: any
        try {
          fulfillment = await fulfillmentService.retrieveFulfillment(data.id, {
            relations: ["items", "labels"],
          })
        } catch {
          fulfillment = data
        }

        let orderId = fulfillment?.order_id || data.order_id
        let invoice = `Order ${orderId || "?"}`
        let orderDisplayId = ""

        if (orderId) {
          try {
            const orderService = container.resolve(Modules.ORDER)
            const order = await orderService.retrieveOrder(orderId)
            invoice = String(order.metadata?.invoice_number || `#${order.display_id}`)
            orderDisplayId = `#${order.display_id}`
          } catch {}
        }

        const trackingNumber = fulfillment?.tracking_numbers?.[0]
          || fulfillment?.labels?.[0]?.tracking_number
          || data.tracking_number
          || "—"
        const carrier = fulfillment?.metadata?.carrier
          || fulfillment?.metadata?.courier_name
          || data.carrier
          || "—"

        message = [
          `📦 <b>Shipped — ChamkileyStore</b>`,
          ``,
          `📋 Invoice: <code>${escapeHtml(String(invoice))}</code>`,
          `🚚 Carrier: ${escapeHtml(String(carrier))}`,
          `📝 AWB: <code>${escapeHtml(String(trackingNumber))}</code>`,
          ``,
          `🕐 ${formatTime()}`,
        ].join("\n")

        break
      }

      // ── Fulfillment Cancelled ──
      case "fulfillment.canceled": {
        let orderId = data.order_id
        let invoice = `Order ${orderId || "?"}`

        if (orderId) {
          try {
            const orderService = container.resolve(Modules.ORDER)
            const order = await orderService.retrieveOrder(orderId)
            invoice = String(order.metadata?.invoice_number || `#${order.display_id}`)
          } catch {}
        }

        message = [
          `❌ <b>Fulfillment Cancelled — ChamkileyStore</b>`,
          ``,
          `📋 Invoice: <code>${escapeHtml(String(invoice))}</code>`,
          ``,
          `🕐 ${formatTime()}`,
        ].join("\n")

        break
      }

      // ── Order Cancelled ──
      case "order.canceled": {
        const orderService = container.resolve(Modules.ORDER)
        let order: any
        try {
          order = await orderService.retrieveOrder(data.id, {
            relations: ["summary"],
          })
        } catch {
          order = data
        }

        const invoice = order?.metadata?.invoice_number || `#${order?.display_id || data.id}`
        const total = order?.summary?.current_order_total ?? 0

        message = [
          `🚫 <b>Order Cancelled — ChamkileyStore</b>`,
          ``,
          `📋 Invoice: <code>${escapeHtml(String(invoice))}</code>`,
          total ? `💰 Amount: ${formatINR(total)}` : null,
          ``,
          `🕐 ${formatTime()}`,
        ]
          .filter((l) => l !== null)
          .join("\n")

        break
      }

      // ── Refund Created ──
      case "order.refund_created": {
        let invoice = `Order ${data.order_id || data.id || "?"}`
        let refundAmount = data.amount ?? 0

        if (data.order_id || data.id) {
          try {
            const orderService = container.resolve(Modules.ORDER)
            const order = await orderService.retrieveOrder(data.order_id || data.id)
            invoice = String(order.metadata?.invoice_number || `#${order.display_id}`)
          } catch {}
        }

        message = [
          `💸 <b>Refund Processed — ChamkileyStore</b>`,
          ``,
          `📋 Invoice: <code>${escapeHtml(String(invoice))}</code>`,
          refundAmount ? `💰 Refunded: ${formatINR(refundAmount)}` : null,
          ``,
          `⏳ Customer will receive refund in 5-7 business days`,
          `🕐 ${formatTime()}`,
        ]
          .filter((l) => l !== null)
          .join("\n")

        break
      }

      default:
        return
    }

    if (message) {
      const sent = await sendTelegramMessage(message, logger)
      if (sent) {
        logger.info(`[telegram] Alert sent for "${eventName}"`)
      }
    }
  } catch (err: any) {
    logger.warn(`[telegram] Failed to send alert for "${eventName}": ${err?.message || String(err)}`)
  }
}

export const config: SubscriberConfig = {
  event: [
    "order.placed",
    "fulfillment.created",
    "fulfillment.canceled",
    "order.canceled",
    "order.refund_created",
  ],
}
