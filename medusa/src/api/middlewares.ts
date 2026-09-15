import { defineMiddlewares } from "@medusajs/medusa"
import type { MedusaRequest, MedusaResponse, MedusaNextFunction } from "@medusajs/framework/http"

/**
 * Middleware to patch order responses so that fulfillments always have
 * valid `items`, `labels`, and `shipping_option` fields.
 *
 * Medusa v2.21's dashboard crashes with "toFixed is not a function"
 * when fulfillment.items is undefined (e.g., Shiprocket-created fulfillments
 * that don't populate the items relation).
 *
 * This middleware intercepts the JSON response and fills in safe defaults
 * before the dashboard tries to render them.
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
        order.fulfillments = (
          order.fulfillments as Record<string, unknown>[]
        ).map((f) => {
          if (!Array.isArray(f.items)) {
            f.items = []
          }
          if (!Array.isArray(f.labels)) {
            f.labels = []
          }
          if (
            f.shipping_option &&
            typeof f.shipping_option === "object" &&
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
