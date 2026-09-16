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

export default defineMiddlewares({
  routes: [
    {
      matcher: "/admin/orders/:id",
      method: "GET",
      middlewares: [patchFulfillmentDefaults],
    },
  ],
})
