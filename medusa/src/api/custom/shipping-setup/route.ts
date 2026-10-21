import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"

/**
 * POST /custom/shipping-setup
 *
 * One-time setup endpoint to configure conditional price rules on
 * the Standard Shipping option.
 *
 * Creates 2 price rules:
 *   - ₹100 when item_total <= 999 (standard shipping)
 *   - ₹0 when item_total >= 1000 (free shipping)
 *
 * After running this, the "Free Shipping" option can be removed
 * from MedusaJS Admin since the tiers are now on one option.
 *
 * This endpoint is idempotent — running it again clears old rules
 * and recreates them.
 *
 * Request body (optional):
 * {
 *   "threshold": 1000,      // default 1000
 *   "standardCost": 100,    // default 100
 *   "dryRun": true           // default false
 * }
 */
export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const logger = req.scope.resolve("logger") as any

  try {
    const body = (req.body || {}) as any
    const threshold = Number(body.threshold || 1000)
    const standardCost = Number(body.standardCost || 100)
    const dryRun = body.dryRun === true

    const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)

    // Find the Standard Shipping option (non-return, non-free, flat rate)
    const { data: shippingOptions } = await query.graph({
      entity: "shipping_option",
      fields: [
        "id",
        "name",
        "price_type",
        "rules.attribute",
        "rules.value",
        "prices.id",
        "prices.amount",
        "prices.currency_code",
        "prices.price_set_id",
        "prices.price_rules.*",
      ],
    })

    const standardOption = (shippingOptions as any[]).find((opt) => {
      const rules = opt.rules || []
      const isReturn = rules.some(
        (r: any) => r.attribute === "is_return" && r.value === "true"
      )
      const isFree = opt.name?.toLowerCase().includes("free")
      return !isReturn && !isFree && opt.price_type === "flat"
    })

    if (!standardOption) {
      return res.status(404).json({
        error: "No Standard Shipping option found",
        all_options: (shippingOptions as any[]).map((o: any) => ({
          id: o.id,
          name: o.name,
          price_type: o.price_type,
        })),
      })
    }

    logger.info(
      `[shipping-setup] Found Standard Shipping: ${standardOption.id} (${standardOption.name})`
    )

    if (dryRun) {
      return res.json({
        dryRun: true,
        standardOption: {
          id: standardOption.id,
          name: standardOption.name,
          currentPrices: standardOption.prices,
        },
        willConfigure: {
          threshold,
          standardCost,
          rules: [
            { amount: standardCost, rule: `item_total lte ${threshold - 1}` },
            { amount: 0, rule: `item_total gte ${threshold}` },
          ],
        },
      })
    }

    // Use the Pricing Module to add conditional prices
    const pricingModule = req.scope.resolve(Modules.PRICING) as any

    // Get price_set_id from the prices array (price_set traversal doesn't work for shipping options)
    const firstPrice = standardOption.prices?.[0]
    const priceSetId = firstPrice?.price_set_id
    if (!priceSetId) {
      return res.status(500).json({
        error: "Could not find price_set_id on the shipping option's prices",
        option: standardOption,
      })
    }

    logger.info(`[shipping-setup] Price set ID: ${priceSetId}`)

    // Remove existing prices (clean slate)
    const existingPriceIds = (standardOption.prices || []).map((p: any) => p.id)
    if (existingPriceIds.length > 0) {
      logger.info(
        `[shipping-setup] Removing ${existingPriceIds.length} existing prices: ${existingPriceIds.join(", ")}`
      )
      await pricingModule.removePrices(existingPriceIds)
    }

    // Add new conditional prices
    await pricingModule.addPrices({
      priceSetId,
      prices: [
        {
          currency_code: "inr",
          amount: standardCost,
          rules: {
            item_total: {
              operator: "lte",
              value: threshold - 1,
            },
          },
        },
        {
          currency_code: "inr",
          amount: 0,
          rules: {
            item_total: {
              operator: "gte",
              value: threshold,
            },
          },
        },
      ],
    })

    logger.info(
      `[shipping-setup] ✅ Configured: ₹${standardCost} when item_total <= ${threshold - 1}, ₹0 when item_total >= ${threshold}`
    )

    // Verify
    const { data: verified } = await query.graph({
      entity: "shipping_option",
      fields: [
        "id",
        "name",
        "prices.id",
        "prices.amount",
        "prices.currency_code",
        "prices.price_rules.*",
      ],
      filters: { id: standardOption.id },
    })

    return res.json({
      success: true,
      message: `Configured conditional pricing on "${standardOption.name}"`,
      threshold,
      standardCost,
      rules: [
        `₹${standardCost} when item_total <= ${threshold - 1}`,
        `₹0 (free) when item_total >= ${threshold}`,
      ],
      verifiedData: (verified as any[])?.[0],
    })
  } catch (err: any) {
    logger.error(`[shipping-setup] Error: ${err?.message ?? String(err)}`)
    return res.status(500).json({ error: err?.message ?? String(err) })
  }
}
