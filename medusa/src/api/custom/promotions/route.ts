import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

/**
 * GET /custom/promotions?code=FESTIVE2026
 *
 * Public endpoint that lets the storefront validate a promotion code.
 * Uses MedusaJS Query module (works in all route contexts).
 */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const code = (req.query.code as string || "").trim()

  if (!code) {
    return res.status(400).json({ error: "Missing ?code= query parameter" })
  }

  const logger = req.scope.resolve("logger") as any

  try {
    const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)

    const { data: promotions } = await query.graph({
      entity: "promotion",
      fields: [
        "id",
        "code",
        "status",
        "type",
        "is_automatic",
        "created_at",
        "updated_at",
        "application_method.type",
        "application_method.value",
        "application_method.target_type",
        "application_method.allocation",
        "application_method.currency_code",
      ],
      filters: { code },
    })

    logger.info(`[custom/promotions] code="${code}" → found ${promotions?.length ?? 0}`)

    return res.json({ promotions: promotions || [] })
  } catch (err: any) {
    logger.error(`[custom/promotions] Error: ${err?.message}`)
    return res.status(500).json({
      error: "Failed to look up promotion",
      message: err?.message,
    })
  }
}
