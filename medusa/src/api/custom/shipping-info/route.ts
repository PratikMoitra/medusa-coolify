import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

/**
 * GET /custom/shipping-info
 *
 * Public endpoint — returns shipping cost tiers for the storefront.
 *
 * Reads shipping options and their conditional price rules from MedusaJS's
 * Pricing Module via the Query Graph API (price_set traversal).
 *
 * The Standard Shipping option should have conditional prices configured:
 *   - ₹100 when item_total <= 999
 *   - ₹0   when item_total >= 1000
 *
 * These are set up via POST /custom/shipping-setup or MedusaJS Admin.
 *
 * Response:
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

    // Fetch shipping options with price_set traversal (docs recommended approach)
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
        "prices.price_rules.attribute",
        "prices.price_rules.value",
        "prices.price_rules.operator",
      ],
    })

    // Filter: non-return shipping options only
    const storeOptions = (shippingOptions as any[]).filter((opt) => {
      const rules = opt.rules || []
      const isReturn = rules.some(
        (r: any) => r.attribute === "is_return" && r.value === "true"
      )
      return !isReturn
    })

    logger.info(
      `[shipping-info] Found ${storeOptions.length} non-return shipping options`
    )

    let tiers: Array<{
      min: number
      max: number | null
      shipping_cost: number
      label?: string
    }> = []
    let currencyCode = "inr"

    // Find a shipping option with conditional price rules
    for (const opt of storeOptions) {
      const prices = opt.prices || []
      if (prices.length === 0) continue

      currencyCode = prices[0]?.currency_code || "inr"

      // Check if any price has price_rules (conditional pricing)
      const pricesWithRules = prices.filter(
        (p: any) => p.price_rules && p.price_rules.length > 0
      )

      if (pricesWithRules.length < 2) continue

      logger.info(
        `[shipping-info] Option "${opt.name}" has ${pricesWithRules.length} conditional prices`
      )

      // Parse each conditional price
      const parsedPrices: Array<{
        amount: number
        threshold: number
        operator: string
      }> = []

      for (const price of pricesWithRules) {
        for (const rule of price.price_rules) {
          if (
            rule.attribute === "item_total" ||
            rule.attribute === "order_total" ||
            rule.attribute === "cart_total"
          ) {
            parsedPrices.push({
              amount: price.amount ?? 0,
              threshold: Number(rule.value),
              operator: rule.operator || "gte",
            })
          }
        }
      }

      if (parsedPrices.length < 2) continue

      // Sort by threshold ascending
      parsedPrices.sort((a, b) => a.threshold - b.threshold)

      logger.info(
        `[shipping-info] Parsed prices: ${JSON.stringify(parsedPrices)}`
      )

      // Build tiers from lte/gte pairs
      // Example: [{amount:100, threshold:999, operator:"lte"}, {amount:0, threshold:1000, operator:"gte"}]
      // → tiers: [{min:0, max:1000, cost:100}, {min:1000, max:null, cost:0}]

      const ltePrices = parsedPrices.filter(
        (p) => p.operator === "lte" || p.operator === "lt"
      )
      const gtePrices = parsedPrices.filter(
        (p) => p.operator === "gte" || p.operator === "gt"
      )

      if (ltePrices.length > 0 && gtePrices.length > 0) {
        // Collect all breakpoints
        const breakpoints = new Set<number>()
        breakpoints.add(0)
        for (const p of ltePrices) {
          breakpoints.add(p.threshold + 1)
        }
        for (const p of gtePrices) {
          breakpoints.add(p.threshold)
        }
        const sortedBP = [...breakpoints].sort((a, b) => a - b)

        for (let i = 0; i < sortedBP.length; i++) {
          const rangeStart = sortedBP[i]
          const rangeEnd = sortedBP[i + 1] ?? null

          // Find which price applies at rangeStart
          const matchingPrice =
            ltePrices.find((p) => rangeStart <= p.threshold) ||
            gtePrices.find((p) => rangeStart >= p.threshold)

          if (matchingPrice) {
            tiers.push({
              min: rangeStart,
              max: rangeEnd,
              shipping_cost: matchingPrice.amount,
            })
          }
        }
      } else {
        // Fallback: all same operator direction — sort by threshold
        for (let i = 0; i < parsedPrices.length; i++) {
          const curr = parsedPrices[i]
          const next = parsedPrices[i + 1]
          tiers.push({
            min: i === 0 ? 0 : curr.threshold,
            max: next?.threshold ?? null,
            shipping_cost: curr.amount,
          })
        }
      }

      if (tiers.length > 0) break
    }

    // If no conditional rules found, check if there are separate
    // "Standard" and "Free" shipping options (legacy setup)
    if (tiers.length === 0) {
      const standardOpt = storeOptions.find(
        (o) => !o.name?.toLowerCase().includes("free") && o.prices?.length > 0
      )
      const freeOpt = storeOptions.find(
        (o) => o.name?.toLowerCase().includes("free") && o.prices?.length > 0
      )

      if (standardOpt && freeOpt) {
        const standardPrice =
          standardOpt.prices.find((p: any) => p.amount > 0)?.amount ||
          standardOpt.prices[0]?.amount ||
          0
        const freePrice = freeOpt.prices[0]?.amount || 0

        logger.warn(
          `[shipping-info] No conditional rules. Using legacy: Standard=₹${standardPrice}, Free=₹${freePrice}. ` +
            `Run POST /custom/shipping-setup to configure conditional price rules.`
        )

        // Without conditional rules, we can only report what's available
        // The checkout code's threshold logic will still apply
        tiers = [
          { min: 0, max: null, shipping_cost: standardPrice },
        ]
      } else if (standardOpt) {
        const price = standardOpt.prices[0]?.amount || 0
        tiers = [{ min: 0, max: null, shipping_cost: price }]
      }
    }

    if (tiers.length === 0) {
      logger.error(
        `[shipping-info] No shipping options or prices found in MedusaJS!`
      )
      return res.status(500).json({
        error:
          "No shipping options configured in MedusaJS. " +
          "Create a shipping option in Admin → Settings → Regions, " +
          "then run POST /custom/shipping-setup to configure conditional pricing.",
      })
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
      currency_code: currencyCode,
    })
  } catch (err: any) {
    logger.error(`[shipping-info] Error: ${err?.message ?? String(err)}`)
    return res.status(500).json({
      error: `Failed to fetch shipping info: ${err?.message}`,
    })
  }
}
