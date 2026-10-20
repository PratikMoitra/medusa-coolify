import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"

/**
 * GET /custom/promotions?code=FESTIVE2026
 *
 * Public endpoint that lets the storefront validate a promotion code
 * without needing a cart or publishable API key.
 *
 * Placed under /custom/ instead of /store/ to avoid MedusaJS's
 * publishable API key middleware which scopes /store/* routes.
 */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const code = (req.query.code as string || "").trim()

  if (!code) {
    return res.status(400).json({ error: "Missing ?code= query parameter" })
  }

  const logger = req.scope.resolve("logger") as any

  try {
    const promotionService = req.scope.resolve("promotionModuleService") as any

    const promotions = await promotionService.listPromotions(
      { code: [code] },
      {
        relations: ["application_method"],
      }
    )

    logger.info(`[custom/promotions] code="${code}" → found ${promotions?.length ?? 0}`)

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
    logger.error(`[custom/promotions] Error: ${err?.message}`)
    logger.error(`[custom/promotions] Stack: ${err?.stack}`)
    return res.status(500).json({
      error: "Failed to look up promotion",
      message: err?.message,
    })
  }
}
