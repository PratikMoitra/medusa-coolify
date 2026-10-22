import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"

/**
 * DELETE /custom/category-cleanup
 *
 * Removes a product category by handle. Products in the category
 * are NOT deleted — they just lose the category association.
 *
 * Query params:
 *   handle: the category handle to delete (required)
 */
export async function DELETE(req: MedusaRequest, res: MedusaResponse) {
  const logger = req.scope.resolve("logger") as any

  try {
    const handle = (req.query.handle as string)?.toLowerCase()?.trim()
    if (!handle) {
      return res.status(400).json({ error: "handle query param is required" })
    }

    const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)
    const productCategoryModule = req.scope.resolve(Modules.PRODUCT) as any

    // Find the category
    const { data: categories } = await query.graph({
      entity: "product_category",
      fields: ["id", "name", "handle"],
      filters: { handle },
    })

    const category = (categories as any[])?.[0]
    if (!category) {
      return res.status(404).json({
        error: `Category with handle "${handle}" not found`,
      })
    }

    logger.info(
      `[category-cleanup] Deleting category: "${category.name}" (${category.id}, handle=${category.handle})`
    )

    // Delete the category
    await productCategoryModule.deleteProductCategories(category.id)

    logger.info(`[category-cleanup] ✅ Deleted category "${category.name}"`)

    return res.json({
      success: true,
      deleted: {
        id: category.id,
        name: category.name,
        handle: category.handle,
      },
    })
  } catch (err: any) {
    logger.error(`[category-cleanup] Error: ${err?.message ?? String(err)}`)
    return res.status(500).json({ error: err?.message ?? String(err) })
  }
}
