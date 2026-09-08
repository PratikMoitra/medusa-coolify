import type { SubscriberArgs, SubscriberConfig } from "@medusajs/framework"

/**
 * Subscriber: n8n-event-forwarder
 *
 * Universal catch-all subscriber that forwards ALL Medusa events to n8n
 * via two channels:
 *
 *   1. Redis pub/sub channel `medusa:events` (real-time, picked up by
 *      n8n's Redis Trigger node)
 *   2. HTTP webhook POST to n8n (fallback, with retry + shared secret)
 *
 * This dual-channel approach ensures no events are lost: Redis provides
 * sub-millisecond latency, while the webhook acts as a safety net when
 * n8n misses a Redis message (e.g., during restarts).
 *
 * Configuration (env vars):
 *   - N8N_WEBHOOK_URL:    Internal Docker URL (e.g., http://n8n:5678/webhook/medusa-events)
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
    // Another call is already connecting — wait briefly then retry
    await sleep(500)
    return redisPub?.status === "ready" ? redisPub : null
  }

  try {
    redisConnecting = true
    // Dynamic require from pnpm hoisted deps — ioredis is a transitive
    // dependency of @medusajs/medusa/event-bus-redis
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
  event: { name, data },
  container,
}: SubscriberArgs) {
  const logger = container.resolve("logger")
  const webhookUrl = process.env.N8N_WEBHOOK_URL
  const webhookSecret = process.env.N8N_WEBHOOK_SECRET
  const redisUrl = process.env.REDIS_URL

  // Skip forwarding our own internal noise
  if (!webhookUrl && !redisUrl) return

  const payload = {
    event: name,
    data,
    timestamp: new Date().toISOString(),
    source: "medusa",
  }

  const jsonPayload = JSON.stringify(payload)

  // ── Channel 1: Redis pub/sub ──────────────────────────────────────
  if (redisUrl) {
    try {
      const pub = await getRedisPublisher(redisUrl)
      if (pub) {
        await pub.publish(N8N_REDIS_CHANNEL, jsonPayload)
      }
    } catch (err: any) {
      // Never let Redis failures block the event flow
      logger.warn(
        `[n8n-forwarder] Redis pub/sub failed for "${name}": ${err?.message ?? String(err)}`
      )
    }
  }

  // ── Channel 2: Webhook POST (fallback) ────────────────────────────
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
        signal: AbortSignal.timeout(5000), // 5 second timeout
      })

      if (response.ok) {
        return // Success — done
      }

      logger.warn(
        `[n8n-forwarder] Webhook attempt ${attempt}/${MAX_WEBHOOK_RETRIES} ` +
        `for "${name}" returned ${response.status}`
      )
    } catch (err: any) {
      logger.warn(
        `[n8n-forwarder] Webhook attempt ${attempt}/${MAX_WEBHOOK_RETRIES} ` +
        `for "${name}" failed: ${err?.message ?? String(err)}`
      )
    }

    // Exponential backoff between retries
    if (attempt < MAX_WEBHOOK_RETRIES) {
      await sleep(RETRY_DELAY_MS * attempt)
    }
  }

  logger.error(
    `[n8n-forwarder] All ${MAX_WEBHOOK_RETRIES} webhook attempts failed for event "${name}"`
  )
}

export const config: SubscriberConfig = {
  event: "*", // Listen to ALL Medusa events
}
