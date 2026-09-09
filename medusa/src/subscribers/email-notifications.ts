import type { SubscriberArgs, SubscriberConfig } from "@medusajs/framework"
import { Modules } from "@medusajs/framework/utils"
import { SesNotificationService } from "../modules/ses-notification/service"
import {
  orderConfirmationEmail,
  welcomeEmail,
  refundEmail,
  shippingNotificationEmail,
} from "../modules/ses-notification/templates"

/**
 * Subscriber: email-notifications
 *
 * Listens to key Medusa events and sends branded transactional emails
 * via Amazon SES. Resolves the correct sender address based on the
 * order's sales channel (Chamkiley vs Kalakavya).
 *
 * This subscriber is SEPARATE from the n8n-event-forwarder — that
 * forwards events for automation workflows, this one sends customer
 * emails directly.
 *
 * The SES service is instantiated per-invocation (lightweight) to
 * avoid module registration complexity.
 */

// Cache the SES service instance across invocations
let sesService: SesNotificationService | null = null

function getSesService(container: Record<string, any>): SesNotificationService {
  if (!sesService) {
    sesService = new SesNotificationService(container)
  }
  return sesService
}

/**
 * Helper to resolve the store/sales-channel name for an order.
 * Tries multiple approaches since Medusa v2 event payloads vary.
 */
async function resolveStoreName(
  container: Record<string, any>,
  orderId: string
): Promise<{ storeName: string; storeUrl: string }> {
  try {
    const orderService = container.resolve(Modules.ORDER)
    const order = await orderService.retrieveOrder(orderId)

    // Try to resolve sales channel name from the order's sales_channel_id
    let channelName = ""
    const salesChannelId = (order as any)?.sales_channel_id
    if (salesChannelId) {
      try {
        const scModule = container.resolve(Modules.SALES_CHANNEL)
        const channel = await scModule.retrieveSalesChannel(salesChannelId)
        channelName = channel?.name || ""
      } catch {
        // Sales channel lookup failed, use default
      }
    }

    // Determine store URL based on sales channel
    let storeUrl = process.env.STOREFRONT_URL || ""
    if (channelName.toLowerCase().includes("kalakavya")) {
      storeUrl = process.env.KALAKAVYA_STOREFRONT_URL || storeUrl
    }

    return {
      storeName: channelName || process.env.DEFAULT_STORE_NAME || "Our Store",
      storeUrl,
    }
  } catch {
    return {
      storeName: process.env.DEFAULT_STORE_NAME || "Our Store",
      storeUrl: process.env.STOREFRONT_URL || "",
    }
  }
}

export default async function emailNotifications({
  event,
  container,
}: SubscriberArgs<Record<string, any>>) {
  const logger = container.resolve("logger")
  const ses = getSesService({ logger })
  const eventName = (event as any)?.name ?? "unknown"
  const data = event?.data as Record<string, any> | undefined

  if (!data?.id) {
    logger.warn(`[email-notifications] No ID in event data for "${eventName}"`)
    return
  }

  try {
    switch (eventName) {
      // ── Order Confirmation ──────────────────────────────────────
      case "order.placed": {
        const orderService = container.resolve(Modules.ORDER)
        const order = await orderService.retrieveOrder(data.id, {
          relations: ["items", "shipping_address"],
        })

        if (!order?.email) break

        const { storeName, storeUrl } = await resolveStoreName(container, data.id)
        const email = orderConfirmationEmail({
          display_id: order.display_id,
          items: (order.items || []).map((item: any) => ({
            title: item.title || item.product_title || "Item",
            quantity: item.quantity,
            unit_price: item.unit_price,
            thumbnail: item.thumbnail,
          })),
          total: Number(order.total),
          currency_code: order.currency_code,
          customer_email: order.email,
          customer_name: order.shipping_address?.first_name,
          shipping_address: order.shipping_address,
          created_at: order.created_at ? String(order.created_at) : undefined,
          storeName,
          storeUrl,
        })

        await ses.sendEmail({
          to: order.email,
          subject: email.subject,
          html: email.html,
          salesChannelName: storeName,
        })
        break
      }

      // ── Welcome Email ───────────────────────────────────────────
      case "customer.created": {
        const customerService = container.resolve(Modules.CUSTOMER)
        const customer = await customerService.retrieveCustomer(data.id)

        if (!customer?.email) break

        // For customer events, we don't have a sales channel context.
        // Use the default store name.
        const storeName = process.env.DEFAULT_STORE_NAME || "Our Store"
        const storeUrl = process.env.STOREFRONT_URL || ""

        const email = welcomeEmail({
          email: customer.email,
          first_name: customer.first_name ?? undefined,
          last_name: customer.last_name ?? undefined,
          storeName,
          storeUrl,
        })

        await ses.sendEmail({
          to: customer.email,
          subject: email.subject,
          html: email.html,
          salesChannelName: storeName,
        })
        break
      }

      // ── Refund Processed ────────────────────────────────────────
      case "order.refunded": {
        // In Medusa v2, 'order.refunded' event data contains the order ID
        const orderService = container.resolve(Modules.ORDER)
        const order = await orderService.retrieveOrder(data.id, {
          relations: ["shipping_address"],
        })

        if (!order?.email) break

        const { storeName } = await resolveStoreName(container, data.id)

        // We don't have direct access to refund details from the order module;
        // send a generic refund notification
        const email = refundEmail({
          display_id: order.display_id,
          amount: 0, // Amount not available from this event
          currency_code: order.currency_code,
          customer_email: order.email,
          customer_name: order.shipping_address?.first_name,
          reason: undefined,
          storeName,
        })

        await ses.sendEmail({
          to: order.email,
          subject: email.subject,
          html: email.html,
          salesChannelName: storeName,
        })
        break
      }

      // ── Shipping Notification ───────────────────────────────────
      case "fulfillment.created": {
        // Fulfillment events may need to resolve the order differently
        try {
          const fulfillmentService = container.resolve(Modules.FULFILLMENT)
          const fulfillment = await fulfillmentService.retrieveFulfillment(data.id, {
            relations: ["items"],
          })

         const fulfillmentAny = fulfillment as any

          // Resolve order from fulfillment context
          const orderService = container.resolve(Modules.ORDER)
          const orders = await orderService.listOrders(
            { id: data.order_id || fulfillmentAny?.order_id },
            { relations: ["shipping_address"] }
          )
          const order = orders?.[0]

          if (!order?.email) break

          const { storeName, storeUrl } = await resolveStoreName(container, order.id)

          const email = shippingNotificationEmail({
            display_id: order.display_id,
            tracking_number: fulfillmentAny?.tracking_numbers?.[0],
            tracking_url: fulfillmentAny?.tracking_links?.[0]?.url,
            carrier: fulfillmentAny?.provider_id,
            customer_email: order.email,
            customer_name: order.shipping_address?.first_name,
            storeName,
            storeUrl,
          })

          await ses.sendEmail({
            to: order.email,
            subject: email.subject,
            html: email.html,
            salesChannelName: storeName,
          })
        } catch (err: any) {
          logger.warn(
            `[email-notifications] Could not send shipping email: ${err?.message}`
          )
        }
        break
      }

      default:
        // Other events are handled by n8n-event-forwarder, not here
        break
    }
  } catch (err: any) {
    // Never let email failures crash the event processing
    logger.error(
      `[email-notifications] Error handling "${eventName}": ${err?.message ?? String(err)}`
    )
  }
}

export const config: SubscriberConfig = {
  event: [
    "order.placed",
    "customer.created",
    "order.refunded",
    "fulfillment.created",
  ],
}
