import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

/**
 * GET /custom/shipping-debug
 * 
 * Temporary debug endpoint to inspect raw shipping option data.
 * DELETE after debugging.
 */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  try {
    const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)

    const { data: shippingOptions } = await query.graph({
      entity: "shipping_option",
      fields: [
        "id",
        "name",
        "provider_id",
        "price_type",
        "rules.*",
        "prices.*",
        "prices.price_rules.*",
        "type.*",
      ],
    })

    return res.json({
      count: (shippingOptions as any[]).length,
      options: shippingOptions,
    })
  } catch (err: any) {
    return res.status(500).json({ error: err?.message ?? String(err) })
  }
}
