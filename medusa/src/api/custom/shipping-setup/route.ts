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

    // First, find the price set linked to this shipping option
    let priceSetResult = null
    try {
      const { data } = await query.graph({
        entity: "shipping_option",
        fields: ["id", "price_set.id", "price_set.prices.*", "price_set.prices.price_rules.*"],
        filters: { id: standardOption.id },
      })
      priceSetResult = (data as any[])?.[0]
    } catch (e: any) {
      logger.warn(`[shipping-setup] price_set traversal failed: ${e.message}`)
    }

    const priceSetId = priceSetResult?.price_set?.id
    if (!priceSetId) {
      return res.status(500).json({
        error: "Could not find price_set for the shipping option",
        option: standardOption,
        priceSetResult,
      })
    }

    logger.info(`[shipping-setup] Price set ID: ${priceSetId}`)

    // Remove existing prices (clean slate)
    const existingPrices = priceSetResult.price_set.prices || []
    if (existingPrices.length > 0) {
      const priceIds = existingPrices.map((p: any) => p.id)
      logger.info(
        `[shipping-setup] Removing ${priceIds.length} existing prices: ${priceIds.join(", ")}`
      )
      await pricingModule.removePrices(priceIds)
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
