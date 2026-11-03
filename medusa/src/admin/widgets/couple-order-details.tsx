import { defineWidgetConfig } from "@medusajs/admin-sdk"
import { Container, Heading, Text, Badge } from "@medusajs/ui"

/**
 * Couple Order Details Widget
 *
 * Shows clear His/Her size breakdown for couple t-shirt orders.
 * Detects couple products by variant_title containing "His:" prefix
 * or by product metadata.couple_set flag.
 */

interface OrderItem {
  id: string
  title: string
  subtitle?: string
  variant_title?: string
  variant_sku?: string
  product_title?: string
  product_id?: string
  quantity: number
  thumbnail?: string
  metadata?: Record<string, unknown>
}

interface OrderData {
  id: string
  display_id: number
  items?: OrderItem[]
  metadata?: Record<string, unknown>
}

function parseCoupleVariant(item: OrderItem): {
  hisSize: string
  herSize: string
  color: string
} | null {
  // Try parsing from variant_title: "His: L / Her: XXL / White"
  const title = item.variant_title || item.subtitle || ""
  const match = title.match(
    /His:\s*(\S+)\s*\/\s*Her:\s*(\S+)\s*\/\s*(.+)/i
  )
  if (match) {
    return {
      hisSize: match[1],
      herSize: match[2],
      color: match[3].trim(),
    }
  }

  // Try parsing from SKU: CS-PP-WHT-HL-HXXL → His: L, Her: XXL
  const sku = item.variant_sku || ""
  const skuMatch = sku.match(/H(S|M|L|XL|XXL)-H(S|M|L|XL|XXL)$/i)
  if (skuMatch) {
    return {
      hisSize: skuMatch[1].toUpperCase(),
      herSize: skuMatch[2].toUpperCase(),
      color: "",
    }
  }

  return null
}

function isCoupleProduct(item: OrderItem): boolean {
  const title = item.variant_title || item.subtitle || ""
  if (/His:/i.test(title)) return true
  if (/couple/i.test(item.product_title || "")) return true
  if (/couple/i.test(item.title || "")) return true
  return false
}

function CoupleOrderDetails({ data }: { data: OrderData }) {
  const items = data.items || []
  const coupleItems = items.filter(isCoupleProduct)

  if (coupleItems.length === 0) return null

  return (
    <Container className="divide-y p-0">
      <div className="flex items-center justify-between px-6 py-4">
        <Heading level="h2">Couple Set Details</Heading>
        <Badge color="purple" size="small">
          {coupleItems.length} couple {coupleItems.length === 1 ? "set" : "sets"}
        </Badge>
      </div>

      <div className="px-6 py-4">
        <Text size="small" className="text-ui-fg-muted mb-3">
          Each couple set includes 1 His tee + 1 Her tee. Check sizes below for packing.
        </Text>

        <div className="space-y-4">
          {coupleItems.map((item) => {
            const parsed = parseCoupleVariant(item)

            return (
              <div
                key={item.id}
                className="rounded-lg border border-ui-border-base p-4"
              >
                <div className="flex items-start justify-between mb-3">
                  <div>
                    <Text weight="plus" className="text-ui-fg-base">
                      {item.product_title || item.title}
                    </Text>
                    <Text size="small" className="text-ui-fg-muted">
                      SKU: {item.variant_sku || "N/A"} | Qty: {item.quantity}
                    </Text>
                  </div>
                </div>

                {parsed ? (
                  <div className="grid grid-cols-3 gap-3">
                    <div className="rounded-md border border-blue-200 bg-blue-50 p-3 text-center">
                      <Text
                        size="small"
                        className="text-blue-600 font-medium mb-1 block"
                      >
                        HIS SIZE
                      </Text>
                      <Text
                        size="large"
                        weight="plus"
                        className="text-blue-800"
                      >
                        {parsed.hisSize}
                      </Text>
                    </div>

                    <div className="rounded-md border border-pink-200 bg-pink-50 p-3 text-center">
                      <Text
                        size="small"
                        className="text-pink-600 font-medium mb-1 block"
                      >
                        HER SIZE
                      </Text>
                      <Text
                        size="large"
                        weight="plus"
                        className="text-pink-800"
                      >
                        {parsed.herSize}
                      </Text>
                    </div>

                    <div className="rounded-md border border-ui-border-base bg-ui-bg-subtle p-3 text-center">
                      <Text
                        size="small"
                        className="text-ui-fg-muted font-medium mb-1 block"
                      >
                        COLOR
                      </Text>
                      <Text
                        size="large"
                        weight="plus"
                        className="text-ui-fg-base"
                      >
                        {parsed.color || "—"}
                      </Text>
                    </div>
                  </div>
                ) : (
                  <Text size="small" className="text-ui-fg-muted">
                    Variant: {item.variant_title || item.subtitle || "N/A"}
                  </Text>
                )}

                <div className="mt-3 rounded-md bg-amber-50 border border-amber-200 px-3 py-2">
                  <Text size="small" className="text-amber-800">
                    Pack 2 t-shirts: 1 x His ({parsed?.hisSize || "?"}) + 1 x Her ({parsed?.herSize || "?"})
                    {parsed?.color ? ` in ${parsed.color}` : ""}
                  </Text>
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </Container>
  )
}

export const config = defineWidgetConfig({
  zone: "order.details.after",
})

export default CoupleOrderDetails
