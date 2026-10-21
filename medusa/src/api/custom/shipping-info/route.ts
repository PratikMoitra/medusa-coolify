import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

/**
 * GET /custom/shipping-info
 *
 * Public endpoint — returns shipping cost tiers for the storefront.
 *
 * Reads shipping options + price rules from MedusaJS, builds tiers.
 * If the data can't be parsed, falls back to env vars or sensible defaults.
 *
 * Response shape:
 * {
 *   tiers: [
 *     { min: 0,    max: 1000, shipping_cost: 100, label: "₹100 shipping" },
 *     { min: 1000, max: null, shipping_cost: 0,   label: "Free Shipping"  },
 *   ],
 *   free_shipping_threshold: 1000,
 *   standard_shipping_cost: 100,
 *   currency_code: "inr"
 * }
 */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const logger = req.scope.resolve("logger") as any

  try {
    const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)

    // Fetch all shipping options with price rules
    const { data: shippingOptions } = await query.graph({
      entity: "shipping_option",
      fields: [
        "id",
        "name",
        "provider_id",
        "price_type",
        "rules.attribute",
        "rules.operator",
        "rules.value",
        "prices.id",
        "prices.amount",
        "prices.currency_code",
        "prices.price_rules.attribute",
        "prices.price_rules.value",
        "prices.price_rules.operator",
      ],
    })

    // Filter: non-return, store-enabled options
    const storeOptions = (shippingOptions as any[]).filter((opt) => {
      const rules = opt.rules || []
      const isReturn = rules.some(
        (r: any) => r.attribute === "is_return" && r.value === "true"
      )
      return !isReturn
    })

    logger.info(
      `[shipping-info] Found ${storeOptions.length} store shipping options`
    )

    // Try to extract tiers from price rules
    let tiers: Array<{
      min: number
      max: number | null
      shipping_cost: number
      label?: string
    }> = []

    for (const opt of storeOptions) {
      const prices = opt.prices || []

      if (prices.length < 2) continue

      // Extract price rules and build tiers
      const parsedPrices: Array<{
        amount: number
        threshold: number | null
        operator: string | null
      }> = []

      for (const price of prices) {
        const priceRules = price.price_rules || []
        let threshold: number | null = null
        let operator: string | null = null

        for (const rule of priceRules) {
          if (
            rule.attribute === "item_total" ||
            rule.attribute === "order_total" ||
            rule.attribute === "cart_total"
          ) {
            threshold = Number(rule.value)
            operator = rule.operator || "gte"
          }
        }

        parsedPrices.push({
          amount: price.amount ?? 0,
          threshold,
          operator,
        })
      }

      logger.info(
        `[shipping-info] Option "${opt.name}": ${parsedPrices.length} prices, rules: ${JSON.stringify(parsedPrices)}`
      )

      // Build tiers from parsed prices
      const withThresholds = parsedPrices.filter((p) => p.threshold !== null)
      const withoutThresholds = parsedPrices.filter(
        (p) => p.threshold === null
      )

      if (withThresholds.length >= 1 && withoutThresholds.length >= 1) {
        // Strategy A: base price + conditional prices
        const basePrice = withoutThresholds.sort(
          (a, b) => b.amount - a.amount
        )[0]
        const conditionals = withThresholds.sort(
          (a, b) => a.threshold! - b.threshold!
        )

        tiers.push({
          min: 0,
          max: conditionals[0].threshold!,
          shipping_cost: basePrice.amount,
        })
        for (let i = 0; i < conditionals.length; i++) {
          tiers.push({
            min: conditionals[i].threshold!,
            max: conditionals[i + 1]?.threshold ?? null,
            shipping_cost: conditionals[i].amount,
          })
        }
        break
      }

      if (withThresholds.length >= 2) {
        // Strategy B: all prices have thresholds (lte/gte pairs)
        const sorted = withThresholds.sort(
          (a, b) => a.threshold! - b.threshold!
        )

        for (let i = 0; i < sorted.length; i++) {
          const curr = sorted[i]
          const next = sorted[i + 1]

          if (curr.operator === "lte" || curr.operator === "lt") {
            tiers.push({
              min: i === 0 ? 0 : (sorted[i - 1]?.threshold ?? 0),
              max: curr.threshold! + 1,
              shipping_cost: curr.amount,
            })
          } else if (curr.operator === "gte" || curr.operator === "gt") {
            tiers.push({
              min: curr.threshold!,
              max: next?.threshold ?? null,
              shipping_cost: curr.amount,
            })
          }
        }

        if (tiers.length > 0) break
      }
    }

    // Fallback: use env vars if no tiers could be parsed
    if (tiers.length === 0) {
      const threshold = Number(process.env.FREE_SHIPPING_THRESHOLD || 1000)
      const standardCost = Number(process.env.STANDARD_SHIPPING_COST || 100)

      logger.warn(
        `[shipping-info] No tiers from price rules. Using fallback: threshold=${threshold}, cost=${standardCost}`
      )

      tiers = [
        { min: 0, max: threshold, shipping_cost: standardCost },
        { min: threshold, max: null, shipping_cost: 0 },
      ]
    }

    // Add display labels
    tiers = tiers.map((tier) => ({
      ...tier,
      label:
        tier.shipping_cost === 0
          ? "Free Shipping"
          : `\u20b9${tier.shipping_cost} shipping`,
    }))

    const freeShippingThreshold =
      tiers.find((t) => t.shipping_cost === 0)?.min ?? null
    const standardShippingCost =
      tiers.find((t) => t.shipping_cost > 0)?.shipping_cost ?? null

    logger.info(
      `[shipping-info] Returning ${tiers.length} tiers, threshold=${freeShippingThreshold}, standard=${standardShippingCost}`
    )

    return res.json({
      tiers,
      free_shipping_threshold: freeShippingThreshold,
      standard_shipping_cost: standardShippingCost,
      currency_code: "inr",
    })
  } catch (err: any) {
    logger.error(`[shipping-info] Error: ${err?.message ?? String(err)}`)

    // Even on error, return valid tiers so the storefront never breaks
    const threshold = Number(process.env.FREE_SHIPPING_THRESHOLD || 1000)
    const standardCost = Number(process.env.STANDARD_SHIPPING_COST || 100)

    return res.json({
      tiers: [
        {
          min: 0,
          max: threshold,
          shipping_cost: standardCost,
          label: `\u20b9${standardCost} shipping`,
        },
        {
          min: threshold,
          max: null,
          shipping_cost: 0,
          label: "Free Shipping",
        },
      ],
      free_shipping_threshold: threshold,
      standard_shipping_cost: standardCost,
      currency_code: "inr",
    })
  }
}
