import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

/**
 * GET /custom/shipping-info
 *
 * Public endpoint — returns shipping cost tiers for the storefront.
 *
 * Reads shipping options directly from MedusaJS, including **price_rules**
 * that define conditional pricing (e.g. item_total >= 1000 → free shipping).
 *
 * Detection order:
 *   1. Price rules on the standard shipping option (item_total conditions)
 *   2. A separate "Free Shipping" option with threshold in description/metadata
 *   3. Falls back to a single-tier flat rate
 *
 * All data comes from MedusaJS — no hardcoding.
 */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const logger = req.scope.resolve("logger") as any

  try {
    const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)

    const { data: shippingOptions } = await query.graph({
      entity: "shipping_option",
      fields: [
        "id",
        "name",
        "price_type",
        "data",
        "metadata",
        "rules.attribute",
        "rules.value",
        "prices.id",
        "prices.amount",
        "prices.currency_code",
        "prices.price_rules.id",
        "prices.price_rules.attribute",
        "prices.price_rules.value",
        "prices.price_rules.operator",
      ],
    })

    // Filter out return shipping options
    const storeOptions = (shippingOptions as any[]).filter((opt) => {
      const rules = opt.rules || []
      return !rules.some(
        (r: any) => r.attribute === "is_return" && r.value === "true"
      )
    })

    logger.info(
      `[shipping-info] Found ${storeOptions.length} non-return shipping options`
    )

    // Find Standard Shipping (non-free, has a price > 0)
    const standardOpt = storeOptions.find((o) => {
      const isFree =
        o.name?.toLowerCase().includes("free") ||
        false
      const hasNonZeroPrice = (o.prices || []).some(
        (p: any) => p.amount > 0
      )
      return !isFree && hasNonZeroPrice
    })

    // Find Free Shipping option (separate option, if it exists)
    const freeOpt = storeOptions.find((o) => {
      return o.name?.toLowerCase().includes("free")
    })

    if (!standardOpt && !freeOpt) {
      logger.error(
        `[shipping-info] No shipping options found in MedusaJS! ` +
          `Configure shipping in Admin → Settings → Regions.`
      )
      return res.status(500).json({
        error:
          "No shipping options configured in MedusaJS. " +
          "Create shipping options in Admin → Settings → Regions.",
      })
    }

    const currencyCode =
      standardOpt?.prices?.[0]?.currency_code ||
      freeOpt?.prices?.[0]?.currency_code ||
      "inr"

    // ── Strategy 1: Detect conditional pricing via price_rules ──────────
    // Look for item_total-based price rules on the standard shipping option.
    // Example: price A has rule "item_total lte 999" → amount 200
    //          price B has rule "item_total gte 1000" → amount 0
    let tiersFromRules: Array<{
      min: number
      max: number | null
      shipping_cost: number
      label: string
    }> | null = null
    let thresholdFromRules: number | null = null

    if (standardOpt?.prices?.length) {
      // Collect prices that have item_total price_rules
      const conditionalPrices: Array<{
        amount: number
        attribute: string
        operator: string
        value: number
      }> = []

      for (const price of standardOpt.prices) {
        const rules = price.price_rules || []
        for (const rule of rules) {
          if (rule.attribute === "item_total") {
            conditionalPrices.push({
              amount: price.amount,
              attribute: rule.attribute,
              operator: rule.operator || "eq",
              value: Number(rule.value),
            })
          }
        }
      }

      logger.info(
        `[shipping-info] Found ${conditionalPrices.length} item_total price rules`
      )

      if (conditionalPrices.length >= 2) {
        // Sort by threshold value ascending
        conditionalPrices.sort((a, b) => a.value - b.value)

        // Find the free tier (amount === 0) to extract the threshold
        const freePriceRule = conditionalPrices.find((p) => p.amount === 0)
        const paidPriceRule = conditionalPrices.find((p) => p.amount > 0)

        if (freePriceRule && paidPriceRule) {
          // The free rule's value is the threshold (e.g., gte 1000 → free)
          thresholdFromRules = freePriceRule.value

          tiersFromRules = [
            {
              min: 0,
              max: thresholdFromRules,
              shipping_cost: paidPriceRule.amount,
              label: `₹${paidPriceRule.amount} shipping`,
            },
            {
              min: thresholdFromRules,
              max: null,
              shipping_cost: 0,
              label: "Free Shipping",
            },
          ]

          logger.info(
            `[shipping-info] Built 2 tiers from price rules: ` +
              `₹${paidPriceRule.amount} below ₹${thresholdFromRules}, free above`
          )
        }
      } else if (conditionalPrices.length === 1) {
        const rule = conditionalPrices[0]
        if (rule.amount === 0) {
          // Single rule: free above threshold
          thresholdFromRules = rule.value
          const fallbackPaid =
            standardOpt.prices.find(
              (p: any) => p.amount > 0 && (!p.price_rules || p.price_rules.length === 0)
            )?.amount ?? 0

          if (fallbackPaid > 0) {
            tiersFromRules = [
              {
                min: 0,
                max: thresholdFromRules,
                shipping_cost: fallbackPaid,
                label: `₹${fallbackPaid} shipping`,
              },
              {
                min: thresholdFromRules,
                max: null,
                shipping_cost: 0,
                label: "Free Shipping",
              },
            ]
          }
        }
      }
    }

    // If price rules gave us tiers, use those
    if (tiersFromRules && tiersFromRules.length > 0) {
      logger.info(
        `[shipping-info] Returning ${tiersFromRules.length} tiers (from price rules): ` +
          `threshold=₹${thresholdFromRules}`
      )

      return res.json({
        tiers: tiersFromRules,
        free_shipping_threshold: thresholdFromRules,
        standard_shipping_cost: tiersFromRules[0].shipping_cost,
        currency_code: currencyCode,
      })
    }

    // ── Strategy 2: Separate "Free Shipping" option ─────────────────────
    const standardPrice =
      standardOpt?.prices?.find((p: any) => p.amount > 0)?.amount ?? 0

    let freeShippingThreshold: number | null = null

    if (freeOpt) {
      const description = freeOpt.type?.description || ""
      const metadataThreshold =
        freeOpt.metadata?.free_shipping_threshold ??
        freeOpt.data?.free_shipping_threshold

      // Try to extract number from description (e.g., "above ₹1000" → 1000)
      const numMatch = description.match(/(?:above|over|≥|>=)\s*₹?\s*(\d+)/i)
      if (numMatch) {
        freeShippingThreshold = parseInt(numMatch[1], 10)
        logger.info(
          `[shipping-info] Threshold from description: ₹${freeShippingThreshold}`
        )
      } else if (metadataThreshold) {
        freeShippingThreshold = Number(metadataThreshold)
        logger.info(
          `[shipping-info] Threshold from metadata: ₹${freeShippingThreshold}`
        )
      }

      if (!freeShippingThreshold) {
        logger.warn(
          `[shipping-info] Free Shipping option exists but no threshold found. ` +
            `Set the description to "Free shipping on orders above ₹1000" ` +
            `or add metadata.free_shipping_threshold in MedusaJS Admin.`
        )
      }
    }

    // ── Build tiers (fallback path) ─────────────────────────────────────
    const tiers: Array<{
      min: number
      max: number | null
      shipping_cost: number
      label: string
    }> = []

    if (freeShippingThreshold && standardPrice > 0) {
      tiers.push({
        min: 0,
        max: freeShippingThreshold,
        shipping_cost: standardPrice,
        label: `₹${standardPrice} shipping`,
      })
      tiers.push({
        min: freeShippingThreshold,
        max: null,
        shipping_cost: 0,
        label: "Free Shipping",
      })
    } else if (standardPrice > 0) {
      tiers.push({
        min: 0,
        max: null,
        shipping_cost: standardPrice,
        label: `₹${standardPrice} shipping`,
      })
    } else {
      tiers.push({
        min: 0,
        max: null,
        shipping_cost: 0,
        label: "Free Shipping",
      })
    }

    logger.info(
      `[shipping-info] Returning ${tiers.length} tiers (fallback): ` +
        `standard=₹${standardPrice}, threshold=₹${freeShippingThreshold}`
    )

    return res.json({
      tiers,
      free_shipping_threshold: freeShippingThreshold,
      standard_shipping_cost: standardPrice,
      currency_code: currencyCode,
    })
  } catch (err: any) {
    logger.error(`[shipping-info] Error: ${err?.message ?? String(err)}`)
    return res.status(500).json({
      error: `Failed to fetch shipping info: ${err?.message}`,
    })
  }
}
