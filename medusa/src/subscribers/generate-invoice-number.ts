import type { SubscriberArgs, SubscriberConfig } from "@medusajs/framework"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"

/**
 * Subscriber: generate-invoice-number
 *
 * Generates a custom invoice number when an order is placed.
 * Format: INVCS{ddmmyy}T{HHMM}{sequence}
 *
 * Example: INVCS121026T1523001 (first invoice on Oct 12, 2026 at 15:23)
 *
 * The sequence resets daily and starts from 001.
 * The overall display_id starts from 3000+ (set by database sequence).
 *
 * Events handled:
 *   - order.placed → generates invoice number, stores in order.metadata.invoice_number
 *   - fulfillment.created / order.fulfillment_created → copies invoice_number
 *     from order.metadata to fulfillment.metadata
 */

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000

function getISTDate(): Date {
  const now = new Date()
  return new Date(now.getTime() + IST_OFFSET_MS)
}

function pad(n: number, len: number = 2): string {
  return String(n).padStart(len, "0")
}

const dailyCounter = new Map<string, number>()

function getNextSequence(dateKey: string): string {
  const current = dailyCounter.get(dateKey) || 0
  const next = current + 1
  dailyCounter.set(dateKey, next)

  for (const key of dailyCounter.keys()) {
    if (key !== dateKey) dailyCounter.delete(key)
  }

  return pad(next, 3)
}

function generateInvoiceNumber(): string {
  const ist = getISTDate()
  const dd = pad(ist.getUTCDate())
  const mm = pad(ist.getUTCMonth() + 1)
  const yy = pad(ist.getUTCFullYear() % 100)
  const HH = pad(ist.getUTCHours())
  const MM = pad(ist.getUTCMinutes())

  const dateKey = `${dd}${mm}${yy}`
  const seq = getNextSequence(dateKey)

  return `INVCS${dd}${mm}${yy}T${HH}${MM}${seq}`
}

export default async function invoiceNumberSubscriber({
  event,
  container,
}: SubscriberArgs<{ id: string; order_id?: string }>) {
  const logger = container.resolve("logger")
  const eventName = event.name

  try {
    if (eventName === "order.placed") {
      await handleOrderPlaced(event.data.id, container, logger)
    } else if (
      eventName === "fulfillment.created" ||
      eventName === "order.fulfillment_created"
    ) {
      await handleFulfillmentCreated(event.data, container, logger)
    }
  } catch (err: any) {
    logger.error(
      `[invoice] Error on ${eventName}: ${err?.message ?? String(err)}`
    )
  }
}

/**
 * On order.placed: generate invoice number and store in order.metadata
 */
async function handleOrderPlaced(
  orderId: string,
  container: Record<string, any>,
  logger: any
) {
  const orderService = container.resolve(Modules.ORDER)

  // Retrieve current order to check if invoice already assigned
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const { data: orders } = await query.graph({
    entity: "order",
    filters: { id: orderId },
    fields: ["id", "metadata"],
  })

  const order = orders?.[0]
  if (order?.metadata?.invoice_number) {
    logger.info(
      `[invoice] Order ${orderId} already has invoice: ${order.metadata.invoice_number}`
    )
    return
  }

  const invoiceNumber = generateInvoiceNumber()

  await orderService.updateOrders(orderId, {
    metadata: {
      ...(order?.metadata || {}),
      invoice_number: invoiceNumber,
    },
  })

  logger.info(`[invoice] ✅ Order ${orderId} → invoice: ${invoiceNumber}`)
}

/**
 * On fulfillment.created: copy invoice_number from order.metadata to fulfillment.metadata
 */
async function handleFulfillmentCreated(
  eventData: { id: string; order_id?: string },
  container: Record<string, any>,
  logger: any
) {
  const fulfillmentId = eventData.id
  if (!fulfillmentId) return

  // Find the order linked to this fulfillment
  let orderId = eventData.order_id
  if (!orderId) {
    const query = container.resolve(ContainerRegistrationKeys.QUERY)
    try {
      const { data: orders } = await query.graph({
        entity: "order",
        filters: {},
        fields: ["id", "metadata", "fulfillments.id"],
      })
      const matchingOrder = orders?.find((o: any) =>
        o.fulfillments?.some((f: any) => f.id === fulfillmentId)
      )
      orderId = matchingOrder?.id
    } catch {
      logger.warn(
        `[invoice] Could not resolve order for fulfillment ${fulfillmentId}`
      )
    }
  }

  if (!orderId) {
    logger.warn(`[invoice] No order found for fulfillment ${fulfillmentId}`)
    return
  }

  // Get the invoice number from order metadata
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const { data: orders } = await query.graph({
    entity: "order",
    filters: { id: orderId },
    fields: ["id", "metadata"],
  })

  const invoiceNumber = orders?.[0]?.metadata?.invoice_number
  if (!invoiceNumber) {
    logger.warn(
      `[invoice] Order ${orderId} has no invoice_number in metadata, skipping fulfillment sync`
    )
    return
  }

  // Store invoice number in fulfillment metadata
  const fulfillmentService = container.resolve(Modules.FULFILLMENT)
  await fulfillmentService.updateFulfillment(fulfillmentId, {
    metadata: {
      invoice_number: invoiceNumber,
    },
  })

  logger.info(
    `[invoice] ✅ Fulfillment ${fulfillmentId} → invoice: ${invoiceNumber}`
  )
}

export const config: SubscriberConfig = {
  event: [
    "order.placed",
    "fulfillment.created",
    "order.fulfillment_created",
  ],
}
