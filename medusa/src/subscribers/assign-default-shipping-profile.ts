import type { SubscriberArgs, SubscriberConfig } from "@medusajs/framework"
import { Modules } from "@medusajs/framework/utils"
import type { IFulfillmentModuleService } from "@medusajs/framework/types"

/**
 * Subscriber: assign-default-shipping-profile
 *
 * Fires on every `product.created` event and ensures the newly created
 * product is linked to the store's default shipping profile.
 *
 * Why this matters:
 *   Medusa v2 requires every product to have a shipping_profile_id so
 *   that shipping options can be resolved correctly at checkout.  When
 *   products are created without one (via the Admin UI, imports, or
 *   third-party integrations) they silently break checkout.
 *
 * What this does:
 *   1. Resolves IFulfillmentModuleService from the DI container.
 *   2. Lists all shipping profiles and selects the one with type "default".
 *   3. If the product already has a shipping profile, it is left unchanged.
 *   4. Otherwise, the product is added to the default shipping profile via
 *      the Fulfillment Module service (no external HTTP call needed).
 *
 * This subscriber is idempotent — running it multiple times on the same
 * product is safe (the association is a set; duplicates are ignored).
 */
export default async function assignDefaultShippingProfileSubscriber({
  event,
  container,
}: SubscriberArgs<{ id: string }>) {
  const productId = event.data?.id
  if (!productId) return

  const logger = container.resolve("logger")

  try {
    const fulfillmentService: IFulfillmentModuleService = container.resolve(
      Modules.FULFILLMENT
    )

    // List all shipping profiles to find the default one
    const profiles = await fulfillmentService.listShippingProfiles(
      {},
      { select: ["id", "name", "type"] }
    )

    if (!profiles || profiles.length === 0) {
      logger.warn(
        `[assign-default-shipping-profile] No shipping profiles found — ` +
          `product "${productId}" will not be assigned a shipping profile. ` +
          `Create a shipping profile in the Admin UI or via the API first.`
      )
      return
    }

    // Prefer a profile with type "default"; fall back to the first one available
    const defaultProfile =
      profiles.find((p) => p.type === "default") ?? profiles[0]

    // Associate the product with the default shipping profile.
    // updateShippingProfiles accepts a products array — duplicates are safe.
    await (fulfillmentService as any).updateShippingProfiles(defaultProfile.id, {
      products: [{ id: productId }],
    })

    logger.info(
      `[assign-default-shipping-profile] Product "${productId}" linked to ` +
        `shipping profile "${defaultProfile.name}" (${defaultProfile.id})`
    )
  } catch (err: any) {
    // Log and continue — never let a subscriber crash the main product creation flow
    logger.error(
      `[assign-default-shipping-profile] Failed to assign shipping profile ` +
        `to product "${productId}": ${err?.message ?? String(err)}`
    )
  }
}

export const config: SubscriberConfig = {
  event: "product.created",
}
