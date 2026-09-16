import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { shiprocketFetch } from "../auth"

interface AssignAwbBody {
  shipment_id: number
  courier_id?: number
}

interface AwbResponse {
  awb_assign_status?: number
  response?: {
    data?: {
      awb_code?: string
      courier_company_id?: number
      courier_name?: string
    }
  }
  message?: string
}

/**
 * POST /admin/shiprocket/assign-awb
 * Assign a courier to a shipment (generates AWB/tracking number)
 */
export async function POST(req: MedusaRequest, res: MedusaResponse) {
  try {
    const { shipment_id, courier_id } = req.body as AssignAwbBody

    if (!shipment_id) {
      return res.status(400).json({ error: "shipment_id is required" })
    }

    const payload: Record<string, unknown> = { shipment_id }
    if (courier_id) {
      payload.courier_id = courier_id
    }

    const data = await shiprocketFetch<AwbResponse>("/courier/assign/awb", {
      method: "POST",
      body: payload,
    })

    if (data.awb_assign_status === 1 && data.response?.data) {
      return res.json({
        success: true,
        awb_code: data.response.data.awb_code,
        courier_company_id: data.response.data.courier_company_id,
        courier_name: data.response.data.courier_name,
      })
    }

    return res.status(400).json({
      success: false,
      error: data.message || "AWB assignment failed",
      raw: data,
    })
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error"
    return res.status(500).json({ error: message })
  }
}
