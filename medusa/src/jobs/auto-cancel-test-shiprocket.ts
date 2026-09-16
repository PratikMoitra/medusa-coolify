import type { MedusaContainer } from "@medusajs/framework/types"

/**
 * Auto-cancel Shiprocket orders in TEST environment.
 *
 * Runs every minute. Any Shiprocket order that was created more than 5 minutes
 * ago and hasn't been manually cancelled will be automatically cancelled.
 * This prevents test orders from being actually shipped.
 *
 * Only active when ENV=TEST (set via Coolify env vars).
 */

const SR_BASE = "https://apiv2.shiprocket.in/v1/external"

// Track orders pending cancellation: shiprocket_order_id → created_at timestamp
const pendingOrders = new Map<number, number>()

async function getToken(): Promise<string> {
  const email = process.env.SHIPROCKET_EMAIL
  const password = process.env.SHIPROCKET_PASSWORD

  if (!email || !password) throw new Error("Missing Shiprocket credentials")

  const res = await fetch(`${SR_BASE}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  })
  const data = await res.json() as { token?: string }
  if (!data.token) throw new Error("Shiprocket auth failed")
  return data.token
}

async function cancelOrder(token: string, orderId: number): Promise<boolean> {
  const res = await fetch(`${SR_BASE}/orders/cancel`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ ids: [orderId] }),
  })
  return res.ok
}

async function getRecentOrders(token: string): Promise<Array<{ id: number; status: string; created_at: string }>> {
  const res = await fetch(`${SR_BASE}/orders?per_page=20&sort=created_at&sort_by=desc`, {
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
  })
  const data = await res.json() as { data?: Array<{ id: number; status: string; created_at: string }> }
  return data.data || []
}

export default async function autoCancelTestShiprocketOrders(
  container: MedusaContainer
) {
  const env = (process.env.ENV || "").toUpperCase()
  if (env !== "TEST") return

  const logger = container.resolve("logger") as { info: (msg: string) => void; warn: (msg: string) => void }

  try {
    const token = await getToken()
    const orders = await getRecentOrders(token)

    const now = Date.now()
    const FIVE_MINUTES = 1 * 60 * 1000  // 1 minute for faster test cleanup

    // Cancellable statuses (not yet picked up or in transit)
    const cancellableStatuses = new Set([
      "NEW",
      "READY TO SHIP",
      "PICKUP SCHEDULED",
      "new",
      "ready to ship",
      "pickup scheduled",
    ])

    for (const order of orders) {
      const createdAt = new Date(order.created_at).getTime()
      const age = now - createdAt

      // Only process orders older than 5 minutes
      if (age < FIVE_MINUTES) {
        // Track as pending
        if (!pendingOrders.has(order.id) && cancellableStatuses.has(order.status)) {
          pendingOrders.set(order.id, createdAt)
          logger.info(`[auto-cancel-test] Tracking SR order #${order.id} (status: ${order.status}), will cancel in ${Math.ceil((FIVE_MINUTES - age) / 1000)}s`)
        }
        continue
      }

      // Skip if already cancelled/shipped/delivered
      if (!cancellableStatuses.has(order.status)) {
        pendingOrders.delete(order.id)
        continue
      }

      // Cancel the order
      logger.info(`[auto-cancel-test] 🔴 Cancelling SR order #${order.id} (age: ${Math.round(age / 1000)}s, status: ${order.status})`)
      const cancelled = await cancelOrder(token, order.id)

      if (cancelled) {
        logger.info(`[auto-cancel-test] ✅ Cancelled SR order #${order.id}`)
        pendingOrders.delete(order.id)
      } else {
        logger.warn(`[auto-cancel-test] ⚠️ Failed to cancel SR order #${order.id}`)
      }
    }

    // Clean up old entries from tracking map (older than 1 hour)
    const ONE_HOUR = 60 * 60 * 1000
    for (const [id, ts] of pendingOrders) {
      if (now - ts > ONE_HOUR) pendingOrders.delete(id)
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    logger.warn(`[auto-cancel-test] Error: ${msg}`)
  }
}

export const config = {
  name: "auto-cancel-test-shiprocket",
  schedule: "* * * * *", // Every minute
}
