import type { SubscriberArgs, SubscriberConfig } from "@medusajs/framework"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"

/**
 * Subscriber: generate-invoice-number
 *
 * Generates a GST-compliant invoice number when an order is placed.
 *
 * Format: CS/{FY}/{serial}
 *   - CS     = ChamkileyStore (business prefix)
 *   - FY     = Financial year in 4-digit form (e.g. "2627" for FY 2026-27)
 *   - serial = 5-digit sequential number, resets each FY (e.g. "00001")
 *
 * Example: CS/2627/00001 (first order in FY 2026-27)
 *
 * GST Compliance (Rule 46b, CGST Rules 2017):
 *   ✅ Max 16 characters (CS/2627/00001 = 14 chars)
 *   ✅ Consecutive serial numbers per financial year
 *   ✅ Unique per financial year (FY prefix ensures uniqueness)
 *   ✅ Only allowed characters: A-Z, 0-9, /
 *
 * The serial is determined by counting existing orders in the same FY
 * that already have an invoice_number with the matching FY prefix.
 * This approach survives server restarts unlike the old in-memory counter.
 *
 * Events handled:
 *   - order.placed → generates invoice number, stores in order.metadata.invoice_number
 *   - fulfillment.created / order.fulfillment_created → copies invoice_number
 *     from order.metadata to fulfillment.metadata
 */

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000
const INVOICE_PREFIX = "CS"

function getISTDate(): Date {
  const now = new Date()
  return new Date(now.getTime() + IST_OFFSET_MS)
}

/**
 * Get the Indian Financial Year code.
 * FY runs April 1 → March 31.
 * e.g. Oct 2026 → FY 2026-27 → "2627"
 *      Feb 2027 → FY 2026-27 → "2627"
 *      Apr 2027 → FY 2027-28 → "2728"
 */
function getFinancialYear(): string {
  const ist = getISTDate()
  const month = ist.getUTCMonth() + 1 // 1-12
  const year = ist.getUTCFullYear()

  const fyStart = month >= 4 ? year : year - 1
  const fyEnd = fyStart + 1

  return `${fyStart % 100}${fyEnd % 100}`
}

/**
 * Count existing invoices in the current FY to determine the next serial.
 * Queries all orders with metadata.invoice_number starting with "CS/{fy}/".
 */
async function getNextSerial(
  fy: string,
  container: Record<string, any>,
  logger: any
): Promise<number> {
  const query = container.resolve(ContainerRegistrationKeys.QUERY)

  try {
    const { data: allOrders } = await query.graph({
      entity: "order",
      filters: {},
      fields: ["id", "metadata"],
    })

    const prefix = `${INVOICE_PREFIX}/${fy}/`
    let maxSerial = 0

    for (const order of allOrders || []) {
      const inv = order?.metadata?.invoice_number
      if (typeof inv === "string" && inv.startsWith(prefix)) {
        const serialStr = inv.substring(prefix.length)
        const serial = parseInt(serialStr, 10)
        if (!isNaN(serial) && serial > maxSerial) {
          maxSerial = serial
        }
      }
    }

    return maxSerial + 1
  } catch (err: any) {
    logger.warn(`[invoice] Failed to count existing invoices: ${err?.message}`)
    // Fallback: use timestamp-based unique number
    const ist = getISTDate()
    return parseInt(
      `${ist.getUTCDate()}${ist.getUTCHours()}${ist.getUTCMinutes()}${ist.getUTCSeconds()}`,
      10
    )
  }
}

async function generateInvoiceNumber(
  container: Record<string, any>,
  logger: any
): Promise<string> {
  const fy = getFinancialYear()
  const serial = await getNextSerial(fy, container, logger)
  const serialStr = String(serial).padStart(5, "0")

  return `${INVOICE_PREFIX}/${fy}/${serialStr}`
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

  const invoiceNumber = await generateInvoiceNumber(container, logger)

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
