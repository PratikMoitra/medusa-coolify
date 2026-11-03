import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

/**
 * GET /custom/shipping-info
 *
 * Public endpoint — returns shipping cost tiers for the storefront.
 *
 * Reads shipping options directly from MedusaJS. Looks for:
 *   - A "Standard Shipping" option (non-return, non-free) → its price is the standard shipping cost
 *   - A "Free Shipping" option → its existence and the free_shipping_threshold from its type description
 *
 * The threshold is read from the "Free Shipping" option's type description
 * (configured in MedusaJS Admin as "Free shipping on orders above ₹1000").
 * If no description, falls back to reading the threshold from the
 * shipping option metadata.
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
        "type.id",
        "type.label",
        "type.description",
        "type.code",
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
        o.type?.code?.includes("free")
      const hasNonZeroPrice = (o.prices || []).some(
        (p: any) => p.amount > 0
      )
      return !isFree && hasNonZeroPrice
    })

    // Find Free Shipping option
    const freeOpt = storeOptions.find((o) => {
      return (
        o.name?.toLowerCase().includes("free") ||
        o.type?.code?.includes("free")
      )
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

    const standardPrice =
      standardOpt?.prices?.find((p: any) => p.amount > 0)?.amount ?? 0
    const currencyCode =
      standardOpt?.prices?.[0]?.currency_code ||
      freeOpt?.prices?.[0]?.currency_code ||
      "inr"

    // Extract threshold from Free Shipping option's type description
    // Expected format: "Free shipping on orders above ₹1000"
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

    // Build tiers
    const tiers: Array<{
      min: number
      max: number | null
      shipping_cost: number
      label: string
    }> = []

    if (freeShippingThreshold && standardPrice > 0) {
      // Two-tier: standard below threshold, free above
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
      // Only standard shipping, no free option
      tiers.push({
        min: 0,
        max: null,
        shipping_cost: standardPrice,
        label: `₹${standardPrice} shipping`,
      })
    } else {
      // Only free shipping
      tiers.push({
        min: 0,
        max: null,
        shipping_cost: 0,
        label: "Free Shipping",
      })
    }

    logger.info(
      `[shipping-info] Returning ${tiers.length} tiers: ` +
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
