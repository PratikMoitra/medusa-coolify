import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"

/**
 * GET /custom/promotions?code=FESTIVE2026
 *
 * Public endpoint that lets the storefront validate a promotion code.
 * Placed under /custom/ to avoid MedusaJS's store middleware.
 */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const code = (req.query.code as string || "").trim()

  if (!code) {
    return res.status(400).json({ error: "Missing ?code= query parameter" })
  }

  const logger = req.scope.resolve("logger") as any

  try {
    const promotionService = req.scope.resolve("promotionModuleService") as any

    // First try without relations to avoid potential relation issues
    let promotions: any[]
    try {
      promotions = await promotionService.listPromotions({ code: [code] })
    } catch (listErr: any) {
      logger.warn(`[custom/promotions] listPromotions failed: ${listErr?.message}, trying retrievePromotion`)
      // Fallback: try listing all and filtering manually
      const all = await promotionService.listPromotions({})
      promotions = all.filter((p: any) => p.code === code)
    }

    logger.info(`[custom/promotions] code="${code}" → found ${promotions?.length ?? 0}`)

    if (!promotions || promotions.length === 0) {
      return res.json({ promotions: [] })
    }

    // Now try to get application_method for each found promotion
    const enriched = await Promise.all(
      promotions.map(async (p: any) => {
        let appMethod = null
        try {
          const full = await promotionService.retrievePromotion(p.id, {
            relations: ["application_method"],
          })
          appMethod = full?.application_method
        } catch {
          // application_method not available, proceed without it
        }

        return {
          id: p.id,
          code: p.code,
          status: p.status,
          type: p.type,
          is_automatic: p.is_automatic,
          application_method: appMethod
            ? {
                type: appMethod.type,
                value: appMethod.value,
                target_type: appMethod.target_type,
                allocation: appMethod.allocation,
                currency_code: appMethod.currency_code,
              }
            : null,
          created_at: p.created_at,
          updated_at: p.updated_at,
        }
      })
    )

    return res.json({ promotions: enriched })
  } catch (err: any) {
    logger.error(`[custom/promotions] Error: ${err?.message}`)
    logger.error(`[custom/promotions] Stack: ${err?.stack}`)
    return res.status(500).json({
      error: "Failed to look up promotion",
      message: err?.message,
    })
  }
}
