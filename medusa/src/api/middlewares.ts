import { defineMiddlewares } from "@medusajs/medusa"
import type {
  MedusaRequest,
  MedusaResponse,
  MedusaNextFunction,
} from "@medusajs/framework/http"

/**
 * Middleware to patch order responses so that fulfillments always have
 * valid `items`, `labels`, and `shipping_option` fields.
 *
 * Medusa v2.21's dashboard crashes with "toFixed is not a function"
 * when fulfillment.items is empty/undefined (e.g., Shiprocket-created
 * fulfillments that don't populate the fulfillment_items join table).
 *
 * The dashboard code reduces over fulfillment.items to calculate totals,
 * and crashes when items are missing/empty because the accumulator
 * becomes undefined.
 *
 * Fix: synthesize fulfillment items from the order items when missing.
 */
function patchFulfillmentDefaults(
  req: MedusaRequest,
  res: MedusaResponse,
  next: MedusaNextFunction
) {
  const originalJson = res.json.bind(res)

  res.json = function (body: Record<string, unknown>) {
    if (body && typeof body === "object") {
      const order = (body as Record<string, unknown>).order as
        | Record<string, unknown>
        | undefined

      if (order && Array.isArray(order.fulfillments)) {
        const orderItems = (order.items || []) as Record<string, unknown>[]

        order.fulfillments = (
          order.fulfillments as Record<string, unknown>[]
        ).map((f) => {
          // If items are missing or empty, synthesize from order items
          if (!Array.isArray(f.items) || f.items.length === 0) {
            f.items = orderItems.map((item) => ({
              id: `synth_fi_${item.id || "unknown"}`,
              fulfillment_id: f.id,
              line_item_id: item.id,
              line_item: item,
              quantity: item.quantity ?? item.fulfilled_quantity ?? 1,
              title: item.title || item.product_title || "Item",
              sku: item.variant_sku || null,
              barcode: item.variant_barcode || null,
            }))
          }

          if (!Array.isArray(f.labels)) {
            f.labels = []
          }

          if (!f.shipping_option || typeof f.shipping_option !== "object") {
            f.shipping_option = {
              id: f.shipping_option_id || "unknown",
              name: "Shiprocket Shipping",
            }
          } else if (
            !(f.shipping_option as Record<string, unknown>).name
          ) {
            ;(f.shipping_option as Record<string, unknown>).name =
              "Shiprocket Shipping"
          }

          return f
        })
      }
    }

    return originalJson(body)
  } as typeof res.json

  next()
}

/**
 * CORS middleware for /custom/* routes.
 *
 * MedusaJS only applies CORS to /store/*, /admin/*, /auth/* routes.
 * Our /custom/* endpoints are called from the storefront browser
 * (e.g., shipping-info, promotions) and need CORS headers.
 *
 * Reads allowed origins from STORE_CORS env var (same as /store/*).
 */
function customCors(
  req: MedusaRequest,
  res: MedusaResponse,
  next: MedusaNextFunction
) {
  const storeCors = process.env.STORE_CORS || ""
  const origin = req.headers.origin || ""

  // Parse STORE_CORS — can be comma-separated or regex patterns
  const allowedOrigins = storeCors
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)

  let isAllowed = false
  for (const pattern of allowedOrigins) {
    if (pattern.startsWith("/") && pattern.endsWith("/")) {
      // Regex pattern like /https:\/\/.*\.chamkileystore\.in/
      try {
        const regex = new RegExp(pattern.slice(1, -1))
        if (regex.test(origin)) {
          isAllowed = true
          break
        }
      } catch {
        // Invalid regex, skip
      }
    } else if (pattern === origin || pattern === "*") {
      isAllowed = true
      break
    }
  }

  if (isAllowed && origin) {
    res.setHeader("Access-Control-Allow-Origin", origin)
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization")
    res.setHeader("Access-Control-Allow-Credentials", "true")
  }

  // Handle preflight
  if (req.method === "OPTIONS") {
    res.status(204).end()
    return
  }

  next()
}

export default defineMiddlewares({
  routes: [
    {
      matcher: "/admin/orders/:id",
      method: "GET",
      middlewares: [patchFulfillmentDefaults],
    },
    {
      matcher: "/custom/*",
      middlewares: [customCors],
    },
  ],
})
