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

async function getRecentOrders(token: string, logger: { info: (msg: string) => void }): Promise<Array<{ id: number; status: string; created_at: string }>> {
  const res = await fetch(`${SR_BASE}/orders`, {
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
  })
  const raw = await res.json() as Record<string, unknown>
  
  // Log raw response structure for debugging
  const keys = Object.keys(raw)
  logger.info(`[auto-cancel-test] SR /orders response keys: ${keys.join(", ")}. HTTP ${res.status}`)
  
  // Shiprocket wraps orders in { data: [...] } or { data: { data: [...] } }
  let orders: Array<{ id: number; status: string; created_at: string }> = []
  if (Array.isArray(raw.data)) {
    orders = raw.data as any
  } else if (raw.data && typeof raw.data === "object" && Array.isArray((raw.data as any).data)) {
    orders = (raw.data as any).data
  }
  
  logger.info(`[auto-cancel-test] Parsed ${orders.length} orders from response`)
  if (orders.length > 0) {
    logger.info(`[auto-cancel-test] First order: id=${orders[0].id} status="${orders[0].status}" created=${orders[0].created_at}`)
  }
  
  return orders
}

export default async function autoCancelTestShiprocketOrders(
  container: MedusaContainer
) {
  const logger = container.resolve("logger") as { info: (msg: string) => void; warn: (msg: string) => void }

  const env = (process.env.ENV || "").toUpperCase()
  logger.info(`[auto-cancel-test] Job triggered. ENV="${process.env.ENV}" (normalized: "${env}"). Active: ${env === "TEST"}`)

  if (env !== "TEST") return

  try {
    const token = await getToken()
    logger.info(`[auto-cancel-test] ✅ Auth OK, fetching recent orders...`)
    const orders = await getRecentOrders(token, logger)
    logger.info(`[auto-cancel-test] Found ${orders.length} orders`)

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
      // Shiprocket returns created_at in IST (UTC+5:30) but without timezone info.
      // new Date() parses it as UTC, so we subtract 5h30m to correct.
      const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000
      const createdAt = new Date(order.created_at).getTime() - IST_OFFSET_MS
      const age = now - createdAt

      logger.info(`[auto-cancel-test] SR #${order.id} status="${order.status}" age=${Math.round(age / 1000)}s`)

      // Only process orders older than 1 minute
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
