import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { shiprocketFetch } from "../auth"

interface OrderStatusBody {
  shiprocket_order_id?: number
  channel_order_id?: string
}

/**
 * POST /admin/shiprocket/order-status
 * Get Shiprocket order details by order ID or channel_order_id
 */
export async function POST(req: MedusaRequest, res: MedusaResponse) {
  try {
    const { shiprocket_order_id, channel_order_id } = req.body as OrderStatusBody

    if (!shiprocket_order_id && !channel_order_id) {
      return res.status(400).json({ error: "shiprocket_order_id or channel_order_id required" })
    }

    if (shiprocket_order_id) {
      const data = await shiprocketFetch(`/orders/show/${shiprocket_order_id}`)
      return res.json({ success: true, data })
    }

    // Search by channel_order_id (Medusa order ID)
    const data = await shiprocketFetch("/orders", {
      params: { search: channel_order_id! },
    })

    return res.json({ success: true, data })
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error"
    return res.status(500).json({ error: message })
  }
}
