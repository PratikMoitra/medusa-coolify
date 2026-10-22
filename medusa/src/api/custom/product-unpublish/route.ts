import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"

/**
 * POST /custom/product-unpublish
 *
 * Sets a product's status to "draft" so it no longer appears
 * in store API queries.
 *
 * Body: { "title_contains": "[TEST]" }
 *   — finds and unpublishes all products whose title contains the string
 *
 * Or: { "handle": "test-wistle-podu" }
 *   — unpublishes by exact handle
 */
export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const logger = req.scope.resolve("logger") as any

  try {
    const body = (req.body || {}) as any
    const titleContains = body.title_contains as string | undefined
    const handle = body.handle as string | undefined

    if (!titleContains && !handle) {
      return res.status(400).json({
        error: "Provide 'title_contains' or 'handle' in request body",
      })
    }

    const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)
    const productModule = req.scope.resolve(Modules.PRODUCT) as any

    // Find matching products
    const { data: products } = await query.graph({
      entity: "product",
      fields: ["id", "title", "handle", "status"],
    })

    const matches = (products as any[]).filter((p) => {
      if (handle && p.handle === handle) return true
      if (titleContains && p.title?.includes(titleContains)) return true
      return false
    })

    if (matches.length === 0) {
      return res.json({
        message: "No matching products found",
        criteria: { titleContains, handle },
      })
    }

    const results: any[] = []
    for (const product of matches) {
      if (product.status === "draft") {
        results.push({ id: product.id, title: product.title, status: "already_draft" })
        continue
      }

      await productModule.updateProducts(product.id, { status: "draft" })
      logger.info(`[product-unpublish] Set "${product.title}" (${product.id}) to draft`)
      results.push({ id: product.id, title: product.title, status: "set_to_draft" })
    }

    return res.json({ success: true, results })
  } catch (err: any) {
    logger.error(`[product-unpublish] Error: ${err?.message ?? String(err)}`)
    return res.status(500).json({ error: err?.message ?? String(err) })
  }
}
