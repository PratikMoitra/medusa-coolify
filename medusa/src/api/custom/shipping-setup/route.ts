import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"

/**
 * POST /custom/shipping-setup
 *
 * Configures the shipping threshold in MedusaJS.
 *
 * Sets up:
 *   1. Standard Shipping option with its flat price (e.g., ₹100)
 *   2. Free Shipping option's type description to include the threshold
 *
 * The /custom/shipping-info endpoint reads these values to determine tiers.
 *
 * Request body:
 * {
 *   "threshold": 1000,       // Free shipping threshold (default 1000)
 *   "standardCost": 100,     // Standard shipping cost (default 100)
 *   "dryRun": true            // Preview changes without applying
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

    // Find all non-return shipping options
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
        "type.id",
        "type.label",
        "type.description",
        "type.code",
      ],
    })

    const storeOptions = (shippingOptions as any[]).filter((opt) => {
      const rules = opt.rules || []
      return !rules.some(
        (r: any) => r.attribute === "is_return" && r.value === "true"
      )
    })

    const standardOpt = storeOptions.find(
      (o) =>
        !o.name?.toLowerCase().includes("free") &&
        !o.type?.code?.includes("free")
    )

    const freeOpt = storeOptions.find(
      (o) =>
        o.name?.toLowerCase().includes("free") ||
        o.type?.code?.includes("free")
    )

    if (!standardOpt || !freeOpt) {
      return res.status(404).json({
        error:
          "Need both 'Standard Shipping' and 'Free Shipping' options in MedusaJS. " +
          "Create them in Admin → Settings → Regions.",
        found: storeOptions.map((o: any) => ({
          id: o.id,
          name: o.name,
          type: o.type?.code,
        })),
      })
    }

    // Current state
    const currentStandardPrice =
      standardOpt.prices?.find((p: any) => p.currency_code === "inr")
        ?.amount ?? 0
    const currentDescription = freeOpt.type?.description || ""

    if (dryRun) {
      return res.json({
        dryRun: true,
        currentState: {
          standardShipping: {
            id: standardOpt.id,
            name: standardOpt.name,
            price: currentStandardPrice,
          },
          freeShipping: {
            id: freeOpt.id,
            name: freeOpt.name,
            typeDescription: currentDescription,
          },
        },
        willConfigure: {
          standardCost,
          threshold,
          freeShippingDescription: `Free shipping on orders above ₹${threshold}`,
        },
      })
    }

    const pricingModule = req.scope.resolve(Modules.PRICING) as any
    const fulfillmentModule = req.scope.resolve(Modules.FULFILLMENT) as any

    // 1. Ensure Standard Shipping has the correct price
    const standardPriceEntry = standardOpt.prices?.find(
      (p: any) => p.currency_code === "inr"
    )
    if (standardPriceEntry && standardPriceEntry.amount !== standardCost) {
      await pricingModule.updatePrices([
        {
          id: standardPriceEntry.id,
          amount: standardCost,
        },
      ])
      logger.info(
        `[shipping-setup] Updated Standard Shipping price: ₹${currentStandardPrice} → ₹${standardCost}`
      )
    } else if (!standardPriceEntry) {
      // Add a price if none exists
      const priceSetId = standardOpt.prices?.[0]?.price_set_id
      if (priceSetId) {
        await pricingModule.addPrices({
          priceSetId,
          prices: [
            {
              currency_code: "inr",
              amount: standardCost,
            },
          ],
        })
        logger.info(
          `[shipping-setup] Added Standard Shipping price: ₹${standardCost}`
        )
      }
    }

    // 2. Update Free Shipping type description with the threshold
    const newDescription = `Free shipping on orders above ₹${threshold}`
    if (freeOpt.type?.id && currentDescription !== newDescription) {
      try {
        await fulfillmentModule.updateShippingOptionTypes(freeOpt.type.id, {
          description: newDescription,
        })
        logger.info(
          `[shipping-setup] Updated Free Shipping description: "${newDescription}"`
        )
      } catch (e: any) {
        // If updateShippingOptionTypes doesn't exist, try direct update
        logger.warn(
          `[shipping-setup] Could not update shipping option type description: ${e.message}. ` +
            `Please update it manually in Admin. The current description is: "${currentDescription}"`
        )
      }
    }

    logger.info(
      `[shipping-setup] ✅ Configured: Standard=₹${standardCost}, Free above ₹${threshold}`
    )

    return res.json({
      success: true,
      message: `Configured shipping: ₹${standardCost} for orders under ₹${threshold}, free above`,
      standardShipping: {
        id: standardOpt.id,
        price: standardCost,
      },
      freeShipping: {
        id: freeOpt.id,
        threshold,
        description: newDescription,
      },
      note:
        currentDescription !== newDescription
          ? `Free Shipping type description should be "${newDescription}". ` +
            `If the update failed, set it manually in MedusaJS Admin → Settings → Regions → Free Shipping.`
          : undefined,
    })
  } catch (err: any) {
    logger.error(`[shipping-setup] Error: ${err?.message ?? String(err)}`)
    return res.status(500).json({ error: err?.message ?? String(err) })
  }
}
