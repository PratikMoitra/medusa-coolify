import type { SubscriberArgs, SubscriberConfig } from "@medusajs/framework"

/**
 * Subscriber: n8n-event-forwarder
 *
 * Forwards key Medusa events to n8n via two channels:
 *
 *   1. Redis pub/sub channel `medusa:events` (real-time, picked up by
 *      n8n's Redis Trigger node)
 *   2. HTTP webhook POST to n8n (primary, with retry + shared secret)
 *
 * Note: The wildcard `event: "*"` does NOT work with Medusa's Redis
 * event bus (BullMQ-based). We explicitly list all events we care about.
 *
 * Configuration (env vars):
 *   - N8N_WEBHOOK_URL:    Webhook endpoint (e.g., https://n8n.example.com/webhook/medusa-events)
 *   - N8N_WEBHOOK_SECRET: Shared secret sent in X-Webhook-Secret header
 *   - REDIS_URL:          Redis connection string (already set for Medusa)
 *
 * The subscriber never throws — failures are logged but don't block
 * the main Medusa event flow.
 */

const N8N_REDIS_CHANNEL = "medusa:events"
const MAX_WEBHOOK_RETRIES = 3
const RETRY_DELAY_MS = 1000

// Lazily created Redis publisher connection (shared across invocations)
let redisPub: any = null
let redisConnecting = false

/** Simple sleep helper */
function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** Get or create a shared Redis publisher connection */
async function getRedisPublisher(redisUrl: string): Promise<any> {
  if (redisPub && redisPub.status === "ready") return redisPub

  if (redisConnecting) {
    await sleep(500)
    return redisPub?.status === "ready" ? redisPub : null
  }

  try {
    redisConnecting = true
    const Redis = require("ioredis")
    redisPub = new Redis(redisUrl, {
      maxRetriesPerRequest: 1,
      connectTimeout: 3000,
      lazyConnect: true,
    })
    await redisPub.connect()
    return redisPub
  } catch {
    redisPub = null
    return null
  } finally {
    redisConnecting = false
  }
}

export default async function n8nEventForwarder({
  event,
  container,
}: SubscriberArgs<Record<string, any>>) {
  const logger = container.resolve("logger")
  const webhookUrl = process.env.N8N_WEBHOOK_URL
  const webhookSecret = process.env.N8N_WEBHOOK_SECRET
  const redisUrl = process.env.REDIS_URL

  if (!webhookUrl && !redisUrl) return

  // Safely extract event name and data
  const eventName = (event as any)?.name ?? "unknown"
  const eventData = event?.data ?? {}

  const payload = {
    event: eventName,
    data: eventData,
    timestamp: new Date().toISOString(),
    source: "medusa",
  }

  const jsonPayload = JSON.stringify(payload)

  logger.info(`[n8n-forwarder] Forwarding event "${eventName}"`)

  // ── Channel 1: Redis pub/sub ──────────────────────────────────────
  if (redisUrl) {
    try {
      const pub = await getRedisPublisher(redisUrl)
      if (pub) {
        await pub.publish(N8N_REDIS_CHANNEL, jsonPayload)
      }
    } catch (err: any) {
      logger.warn(
        `[n8n-forwarder] Redis pub/sub failed for "${eventName}": ${err?.message ?? String(err)}`
      )
    }
  }

  // ── Channel 2: Webhook POST ───────────────────────────────────────
  if (!webhookUrl) return

  for (let attempt = 1; attempt <= MAX_WEBHOOK_RETRIES; attempt++) {
    try {
      const response = await fetch(webhookUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(webhookSecret ? { "X-Webhook-Secret": webhookSecret } : {}),
        },
        body: jsonPayload,
        signal: AbortSignal.timeout(5000),
      })

      if (response.ok) {
        logger.info(`[n8n-forwarder] Event "${eventName}" delivered to n8n`)
        return
      }

      logger.warn(
        `[n8n-forwarder] Webhook attempt ${attempt}/${MAX_WEBHOOK_RETRIES} ` +
        `for "${eventName}" returned ${response.status}`
      )
    } catch (err: any) {
      logger.warn(
        `[n8n-forwarder] Webhook attempt ${attempt}/${MAX_WEBHOOK_RETRIES} ` +
        `for "${eventName}" failed: ${err?.message ?? String(err)}`
      )
    }

    if (attempt < MAX_WEBHOOK_RETRIES) {
      await sleep(RETRY_DELAY_MS * attempt)
    }
  }

  logger.error(
    `[n8n-forwarder] All ${MAX_WEBHOOK_RETRIES} webhook attempts failed for event "${eventName}"`
  )
}

/**
 * Explicit event list — wildcard "*" does NOT work with Redis event bus.
 * Add more events as needed.
 */
export const config: SubscriberConfig = {
  event: [
    // Orders
    "order.placed",
    "order.updated",
    "order.completed",
    "order.canceled",
    "order.fulfillment_created",
    "order.fulfillment_canceled",
    "order.return_requested",
    "order.return_received",
    "order.refund_created",
    // Payments
    "payment.captured",
    "payment.refunded",
    "payment.updated",
    // Customers
    "customer.created",
    "customer.updated",
    // Products
    "product.created",
    "product.updated",
    "product.deleted",
    // Inventory
    "inventory-item.created",
    "inventory-item.updated",
    // Cart
    "cart.created",
    "cart.updated",
    "cart.completed",
    // Fulfillment
    "fulfillment.created",
    "fulfillment.updated",
    "fulfillment.canceled",
    // Shipping
    "shipment.created",
  ],
}
