import type { MedusaContainer } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

/**
 * Scheduled job: Detect abandoned carts
 *
 * Runs every 30 minutes. Finds carts that:
 * 1. Have at least one line item
 * 2. Were last updated between 30 minutes and 7 days ago
 * 3. Have NOT been completed (no order)
 * 4. Have recoverable contact info (email or phone in metadata)
 *
 * Sends a `cart.abandoned` webhook to n8n with full cart details,
 * using the same payload format as the n8n-event-forwarder subscriber.
 *
 * n8n is responsible for deduplication (checking if it already sent
 * a recovery message for this cart_id).
 */

export default async function detectAbandonedCarts(
  container: MedusaContainer
) {
  const logger = container.resolve("logger") as {
    info: (msg: string) => void
    warn: (msg: string) => void
    error: (msg: string) => void
  }

  const webhookUrl = process.env.N8N_WEBHOOK_URL
  const webhookSecret = process.env.N8N_WEBHOOK_SECRET

  if (!webhookUrl) {
    return // n8n not configured — silently skip
  }

  try {
    const query = container.resolve(ContainerRegistrationKeys.QUERY)

    const now = new Date()
    const thirtyMinAgo = new Date(now.getTime() - 30 * 60 * 1000)
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)

    // Find carts updated between 30 min and 7 days ago, not completed
    const { data: carts } = await query.graph({
      entity: "cart",
      filters: {
        completed_at: null as any,
        updated_at: {
          $gte: sevenDaysAgo.toISOString(),
          $lte: thirtyMinAgo.toISOString(),
        },
      },
      fields: [
        "id",
        "email",
        "metadata",
        "customer_id",
        "total",
        "subtotal",
        "currency_code",
        "created_at",
        "updated_at",
        "items.id",
        "items.title",
        "items.variant_id",
        "items.quantity",
        "items.unit_price",
        "items.thumbnail",
      ],
    })

    if (!carts?.length) {
      return // No stale carts — normal
    }

    // Filter to carts with items AND recoverable contact info
    const abandonedCarts = carts.filter((cart: any) => {
      const hasItems = cart.items && cart.items.length > 0
      const hasEmail =
        cart.email ||
        cart.metadata?.recovery_email
      const hasPhone = cart.metadata?.phone
      return hasItems && (hasEmail || hasPhone)
    })

    if (!abandonedCarts.length) {
      return
    }

    logger.info(
      `[abandoned-carts] Found ${abandonedCarts.length} recoverable abandoned cart(s)`
    )

    let sent = 0
    for (const cart of abandonedCarts) {
      const email = cart.email || cart.metadata?.recovery_email || null
      const phone = cart.metadata?.phone || null
      const firstName = cart.metadata?.first_name || null

      const itemsSummary = (cart.items || [])
        .map((i: any) => `${i.title} x${i.quantity}`)
        .join(", ")

      const payload = {
        event: "cart.abandoned",
        data: {
          id: cart.id,
          customer_id: cart.customer_id || "guest",
          email,
          phone,
          first_name: firstName,
          total: cart.total || cart.subtotal || 0,
          currency_code: cart.currency_code || "inr",
          item_count: cart.items?.length || 0,
          items_summary: itemsSummary,
          items: (cart.items || []).map((item: any) => ({
            id: item.id,
            variant_id: item.variant_id,
            title: item.title,
            quantity: item.quantity,
            unit_price: item.unit_price,
            thumbnail: item.thumbnail,
          })),
          cart_created_at: cart.created_at,
          cart_updated_at: cart.updated_at,
          abandoned_at: now.toISOString(),
        },
        timestamp: now.toISOString(),
        source: "medusa",
      }

      try {
        const res = await fetch(webhookUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(webhookSecret
              ? { "X-Webhook-Secret": webhookSecret }
              : {}),
          },
          body: JSON.stringify(payload),
          signal: AbortSignal.timeout(5000),
        })

        if (res.ok) {
          sent++
        } else {
          logger.warn(
            `[abandoned-carts] n8n returned ${res.status} for cart ${cart.id}`
          )
        }
      } catch (err: any) {
        logger.warn(
          `[abandoned-carts] Failed to notify n8n for cart ${cart.id}: ${err?.message}`
        )
      }
    }

    if (sent > 0) {
      logger.info(`[abandoned-carts] Sent ${sent} cart.abandoned event(s) to n8n`)
    }
  } catch (err: any) {
    logger.error(`[abandoned-carts] Job failed: ${err?.message ?? String(err)}`)
  }
}

export const config = {
  name: "detect-abandoned-carts",
  schedule: "*/30 * * * *",
}
