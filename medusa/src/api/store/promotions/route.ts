import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"

/**
 * GET /store/promotions?code=FESTIVE2026
 *
 * Custom store endpoint that lets the storefront validate a promotion code
 * without needing a cart. MedusaJS v2 does not expose a Store API for listing
 * promotions — this route fills that gap.
 *
 * Returns the promotion details (code, status, type, application_method) so
 * the storefront can display discount info and decide whether to apply it at
 * checkout via POST /store/carts/:id/promotions.
 */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const code = (req.query.code as string || "").trim()

  if (!code) {
    return res.status(400).json({ error: "Missing ?code= query parameter" })
  }

  const logger = req.scope.resolve("logger") as any

  try {
    const promotionService = req.scope.resolve("promotionModuleService") as any

    const [promotions] = await promotionService.listAndCountPromotions(
      { code: [code] },
      {
        relations: ["application_method"],
      }
    )

    if (!promotions || promotions.length === 0) {
      return res.json({ promotions: [] })
    }

    const safePromotions = promotions.map((p: any) => ({
      id: p.id,
      code: p.code,
      status: p.status,
      type: p.type,
      is_automatic: p.is_automatic,
      application_method: p.application_method
        ? {
            type: p.application_method.type,
            value: p.application_method.value,
            target_type: p.application_method.target_type,
            allocation: p.application_method.allocation,
            currency_code: p.application_method.currency_code,
          }
        : null,
      created_at: p.created_at,
      updated_at: p.updated_at,
    }))

    return res.json({ promotions: safePromotions })
  } catch (err: any) {
    logger.error(`[store/promotions] Error looking up code "${code}": ${err?.message}`)
    return res.status(500).json({
      error: "Failed to look up promotion",
    })
  }
}
