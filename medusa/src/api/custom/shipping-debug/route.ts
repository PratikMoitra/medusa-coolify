import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

/**
 * GET /custom/shipping-debug
 * 
 * Temporary debug endpoint to inspect raw shipping option data.
 * Tries multiple query strategies to find the right data shape.
 * DELETE after debugging.
 */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  try {
    const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)

    // Strategy 1: Direct shipping_option with prices
    let strategy1: any = null
    try {
      const { data } = await query.graph({
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
      strategy1 = data
    } catch (e: any) {
      strategy1 = { error: e.message }
    }

    // Strategy 2: Via price_set traversal (docs recommended)
    let strategy2: any = null
    try {
      const { data } = await query.graph({
        entity: "shipping_option",
        fields: [
          "id",
          "name",
          "price_type",
          "price_set.*",
          "price_set.prices.*",
          "price_set.prices.rules.*",
          "price_set.prices.price_rules.*",
        ],
      })
      strategy2 = data
    } catch (e: any) {
      strategy2 = { error: e.message }
    }

    // Strategy 3: Query shipping_option_type
    let strategy3: any = null
    try {
      const { data } = await query.graph({
        entity: "shipping_option",
        fields: [
          "id",
          "name",
          "price_type",
          "amount",
          "data",
          "metadata",
          "service_zone.*",
          "shipping_profile.*",
        ],
      })
      strategy3 = data
    } catch (e: any) {
      strategy3 = { error: e.message }
    }

    return res.json({
      strategy1_direct: strategy1,
      strategy2_price_set: strategy2,
      strategy3_meta: strategy3,
    })
  } catch (err: any) {
    return res.status(500).json({ error: err?.message ?? String(err) })
  }
}
