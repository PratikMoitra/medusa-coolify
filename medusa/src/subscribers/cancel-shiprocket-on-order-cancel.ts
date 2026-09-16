import type { SubscriberArgs, SubscriberConfig } from "@medusajs/framework"

const SR_BASE = "https://apiv2.shiprocket.in/v1/external"

let cachedToken: string | null = null
let tokenExpiresAt = 0

async function getToken(): Promise<string> {
  if (cachedToken && Date.now() < tokenExpiresAt) return cachedToken

  const email = process.env.SHIPROCKET_EMAIL
  const password = process.env.SHIPROCKET_PASSWORD
  if (!email || !password) throw new Error("Missing Shiprocket credentials")

  const res = await fetch(`${SR_BASE}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  })
  const data = (await res.json()) as { token?: string }
  if (!data.token) throw new Error("Shiprocket auth failed")

  cachedToken = data.token
  tokenExpiresAt = Date.now() + 9 * 24 * 60 * 60 * 1000
  return cachedToken
}

/**
 * When a Medusa order is cancelled, automatically cancel the
 * corresponding Shiprocket order (if one exists).
 *
 * Flow:
 *   1. Look up Shiprocket order by channel_order_id (Medusa display_id)
 *   2. If found and in a cancellable status, cancel it
 *   3. Log the result
 */
export default async function cancelShiprocketOnOrderCancel({
  event,
  container,
}: SubscriberArgs<{ id: string }>) {
  const logger = container.resolve("logger") as {
    info: (msg: string) => void
    warn: (msg: string) => void
    error: (msg: string) => void
  }

  if (!process.env.SHIPROCKET_EMAIL) return

  const orderId = event?.data?.id
  if (!orderId) {
    logger.warn("[sr-cancel] order.canceled event has no order ID")
    return
  }

  try {
    // Get the order's display_id from Medusa
    const orderService = container.resolve("order") as any
    let displayId: string | number | undefined

    try {
      const order = await orderService.retrieveOrder(orderId, { select: ["display_id"] })
      displayId = order?.display_id
    } catch {
      logger.warn(`[sr-cancel] Could not retrieve order ${orderId}, trying ID as display_id`)
      displayId = orderId
    }

    if (!displayId) {
      logger.warn(`[sr-cancel] No display_id for order ${orderId}`)
      return
    }

    const token = await getToken()

    // Search Shiprocket for this order
    const searchRes = await fetch(`${SR_BASE}/orders?search=${displayId}&per_page=5`, {
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
    })
    const searchData = (await searchRes.json()) as {
      data?: Array<{ id: number; status: string; channel_order_id?: string }>
    }

    const srOrders = searchData.data || []
    if (srOrders.length === 0) {
      logger.info(`[sr-cancel] No Shiprocket order found for Medusa order #${displayId}`)
      return
    }

    const cancellableStatuses = new Set([
      "NEW", "READY TO SHIP", "PICKUP SCHEDULED",
      "new", "ready to ship", "pickup scheduled",
    ])

    for (const srOrder of srOrders) {
      if (!cancellableStatuses.has(srOrder.status)) {
        logger.info(
          `[sr-cancel] SR #${srOrder.id} status "${srOrder.status}" — not cancellable (already shipped/delivered/cancelled)`
        )
        continue
      }

      logger.info(`[sr-cancel] 🔴 Cancelling Shiprocket order #${srOrder.id} (status: ${srOrder.status})`)

      const cancelRes = await fetch(`${SR_BASE}/orders/cancel`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ ids: [srOrder.id] }),
      })

      if (cancelRes.ok) {
        logger.info(`[sr-cancel] ✅ Shiprocket order #${srOrder.id} cancelled successfully`)
      } else {
        const errText = await cancelRes.text()
        logger.error(`[sr-cancel] ❌ Failed to cancel SR #${srOrder.id}: HTTP ${cancelRes.status} ${errText}`)
      }
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    logger.error(`[sr-cancel] Error cancelling Shiprocket order: ${msg}`)
  }
}

export const config: SubscriberConfig = {
  event: ["order.canceled"],
}
