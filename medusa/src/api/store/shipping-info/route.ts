import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

/**
 * GET /store/shipping-info
 *
 * Public endpoint — returns tiered shipping cost data for storefront display.
 * Reads shipping option prices + price rules from Medusa's pricing module
 * to build a dynamic tier map like:
 *
 *   tiers: [
 *     { min: 0,    max: 500,  shipping_cost: 200 },
 *     { min: 500,  max: 1000, shipping_cost: 100 },
 *     { min: 1000, max: null, shipping_cost: 0   },  ← free
 *   ]
 *
 * The storefront uses this to show:
 *   "Add ₹X more to save ₹Y on shipping!"
 *   "Add ₹X more for FREE shipping!"
 */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  try {
    const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)

    // Fetch all shipping options with prices and their conditional rules
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
        "prices.rules_count",
        "prices.price_rules.attribute",
        "prices.price_rules.value",
        "prices.price_rules.operator",
        "type.label",
        "type.description",
      ],
    })

    // Filter: only store-enabled, non-return shipping options
    const storeOptions = (shippingOptions as any[]).filter((opt) => {
      const rules = opt.rules || []
      const isReturn = rules.some(
        (r: any) => r.attribute === "is_return" && r.value === "true"
      )
      const isDisabled = rules.some(
        (r: any) => r.attribute === "enabled_in_store" && r.value === "false"
      )
      return !isReturn && !isDisabled
    })

    let currencyCode = "inr"

    // Build tiers from the primary store shipping option
    // (use the first one with multiple prices, typically the Shiprocket standard option)
    let tiers: Array<{
      min: number
      max: number | null
      shipping_cost: number
      label?: string
    }> = []

    for (const opt of storeOptions) {
      const prices = opt.prices || []
      currencyCode = prices[0]?.currency_code || "inr"

      if (prices.length < 2) continue // Skip options with only one price (no tiers)

      // Extract each price with its threshold rule
      const priceTiers: Array<{
        amount: number
        threshold: number | null
        operator: string | null
      }> = []

      for (const price of prices) {
        const priceRules = price.price_rules || []
        let threshold: number | null = null
        let operator: string | null = null

        for (const rule of priceRules) {
          // Look for item_total / order_total / cart_total rules
          if (
            rule.attribute === "item_total" ||
            rule.attribute === "order_total" ||
            rule.attribute === "cart_total" ||
            rule.attribute === "currency_code" // skip currency rules
          ) {
            if (rule.attribute !== "currency_code") {
              threshold = Number(rule.value)
              operator = rule.operator || "gte"
            }
          }
        }

        priceTiers.push({
          amount: price.amount ?? 0,
          threshold,
          operator,
        })
      }

      // Sort by threshold ascending (null threshold = base/default price)
      priceTiers.sort((a, b) => {
        if (a.threshold === null && b.threshold === null) return 0
        if (a.threshold === null) return -1 // base price first
        if (b.threshold === null) return -1
        return a.threshold - b.threshold
      })

      // Convert to tier ranges
      // If we have: base=₹200, threshold=500→₹100, threshold=1000→₹0
      // Tiers become: [0,500)=₹200, [500,1000)=₹100, [1000,∞)=₹0
      
      if (priceTiers.length >= 2) {
        // Separate: base price (no threshold) vs conditional prices (with threshold)
        const basePrice = priceTiers.find((p) => p.threshold === null)
        const conditionalPrices = priceTiers
          .filter((p) => p.threshold !== null)
          .sort((a, b) => a.threshold! - b.threshold!)

        if (basePrice && conditionalPrices.length > 0) {
          // Build tiers from base + conditionals
          tiers.push({
            min: 0,
            max: conditionalPrices[0].threshold!,
            shipping_cost: basePrice.amount,
          })

          for (let i = 0; i < conditionalPrices.length; i++) {
            const current = conditionalPrices[i]
            const next = conditionalPrices[i + 1]
            tiers.push({
              min: current.threshold!,
              max: next?.threshold ?? null,
              shipping_cost: current.amount,
            })
          }
        } else {
          // No clear base price — sort by amount descending and create tiers
          const sorted = [...priceTiers].sort((a, b) => b.amount - a.amount)
          for (let i = 0; i < sorted.length; i++) {
            tiers.push({
              min: sorted[i].threshold ?? 0,
              max: sorted[i + 1]?.threshold ?? null,
              shipping_cost: sorted[i].amount,
            })
          }
        }

        break // Use the first multi-price option only
      }
    }

    // Fallback: if no tiers detected from price rules, try env-based config
    // Format: SHIPPING_TIERS=0:200,500:100,1000:0
    if (tiers.length === 0 && process.env.SHIPPING_TIERS) {
      const tierParts = process.env.SHIPPING_TIERS.split(",")
      for (let i = 0; i < tierParts.length; i++) {
        const [thresholdStr, costStr] = tierParts[i].split(":")
        const nextThreshold = tierParts[i + 1]
          ? Number(tierParts[i + 1].split(":")[0])
          : null
        tiers.push({
          min: Number(thresholdStr),
          max: nextThreshold,
          shipping_cost: Number(costStr),
        })
      }
    }

    // Fallback 2: single threshold from env
    if (tiers.length === 0 && process.env.FREE_SHIPPING_THRESHOLD) {
      const threshold = Number(process.env.FREE_SHIPPING_THRESHOLD)
      // Find the standard shipping cost from options
      const standardCost = storeOptions
        .flatMap((o: any) => o.prices || [])
        .filter((p: any) => p.amount > 0)
        .sort((a: any, b: any) => b.amount - a.amount)[0]?.amount || 0

      tiers = [
        { min: 0, max: threshold, shipping_cost: standardCost },
        { min: threshold, max: null, shipping_cost: 0 },
      ]
    }

    // Add labels to tiers
    tiers = tiers.map((tier) => ({
      ...tier,
      label:
        tier.shipping_cost === 0
          ? "Free Shipping"
          : `₹${tier.shipping_cost} shipping`,
    }))

    // Determine highest threshold (free shipping target)
    const freeShippingThreshold =
      tiers.find((t) => t.shipping_cost === 0)?.min ?? null

    // Current standard cost (lowest non-free tier)
    const standardShippingCost =
      tiers.find((t) => t.shipping_cost > 0)?.shipping_cost ?? null

    return res.json({
      tiers,
      free_shipping_threshold: freeShippingThreshold,
      standard_shipping_cost: standardShippingCost,
      currency_code: currencyCode,
    })
  } catch (err: any) {
    const logger = req.scope.resolve("logger")
    logger.error(`[shipping-info] Error: ${err?.message ?? String(err)}`)
    return res.status(500).json({ error: "Internal server error" })
  }
}
