import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { shiprocketFetch } from "../auth"

interface PickupBody {
  shipment_id: number
  pickup_date?: string
}

interface PickupResponse {
  pickup_status?: number
  response?: {
    pickup_scheduled_date?: string
    pickup_token_number?: string
  }
  message?: string
}

/**
 * POST /admin/shiprocket/pickup
 * Schedule a pickup for a shipment
 */
export async function POST(req: MedusaRequest, res: MedusaResponse) {
  try {
    const { shipment_id, pickup_date } = req.body as PickupBody

    if (!shipment_id) {
      return res.status(400).json({ error: "shipment_id is required" })
    }

    const payload: Record<string, unknown> = {
      shipment_id: [shipment_id],
    }

    if (pickup_date) {
      payload.pickup_date = [pickup_date]
    }

    const logger = req.scope.resolve("logger") as { info: (msg: string) => void }
    logger.info(`[pickup] Scheduling pickup for shipment_id=${shipment_id}, pickup_date=${pickup_date || "auto"}`)

    const data = await shiprocketFetch<PickupResponse>("/courier/generate/pickup", {
      method: "POST",
      body: payload,
    })

    logger.info(`[pickup] Shiprocket response: ${JSON.stringify(data)}`)

    if (data.pickup_status === 1) {
      return res.json({
        success: true,
        pickup_scheduled_date: data.response?.pickup_scheduled_date,
        pickup_token_number: data.response?.pickup_token_number,
      })
    }

    return res.json({
      success: data.pickup_status !== undefined,
      message: data.message || "Pickup request submitted",
      raw: data,
    })
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error"
    return res.status(500).json({ error: message })
  }
}
