import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { Modules } from "@medusajs/framework/utils"
import { shiprocketFetch } from "../auth"

interface AssignAwbBody {
  shipment_id: number
  courier_id?: number
  medusa_order_id?: string
  courier_rate?: number
  courier_name?: string
  freight_charge?: number
  cod_charges?: number
  etd?: string
  shiprocket_order_id?: number
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

interface WalletResponse {
  data?: {
    balance_amount?: number
  }
}

/**
 * POST /admin/shiprocket/assign-awb
 * Assign a courier to a shipment (generates AWB/tracking number)
 * and persist shipment cost + wallet balance to Medusa order metadata.
 */
export async function POST(req: MedusaRequest, res: MedusaResponse) {
  try {
    const {
      shipment_id,
      courier_id,
      medusa_order_id,
      courier_rate,
      courier_name: requestCourierName,
      freight_charge,
      cod_charges,
      etd,
      shiprocket_order_id,
    } = req.body as AssignAwbBody

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
      const awbCode = data.response.data.awb_code
      const courierCompanyId = data.response.data.courier_company_id
      const courierName = data.response.data.courier_name || requestCourierName

      // Persist shipment cost metadata to the Medusa order
      if (medusa_order_id) {
        try {
          const walletData = await shiprocketFetch<WalletResponse>(
            "/account/details/wallet-balance"
          )
          const walletBalance = walletData.data?.balance_amount ?? null

          const orderModule = req.scope.resolve(Modules.ORDER)
          const order = await orderModule.retrieveOrder(medusa_order_id)
          const existingMetadata = (order as Record<string, unknown>).metadata as Record<string, unknown> || {}

          const shippingMeta = {
            awb_code: awbCode,
            courier_name: courierName,
            courier_id: courierCompanyId || courier_id,
            rate: courier_rate ?? null,
            freight_charge: freight_charge ?? null,
            cod_charges: cod_charges ?? 0,
            etd: etd ?? null,
            wallet_balance_at_assignment: walletBalance,
            assigned_at: new Date().toISOString(),
            shipment_id,
            shiprocket_order_id: shiprocket_order_id ?? null,
            status: "active",
          }

          await orderModule.updateOrders(medusa_order_id, {
            metadata: {
              ...existingMetadata,
              shiprocket_shipping: shippingMeta,
            },
          })
        } catch {
          // Non-blocking: metadata persistence should not fail the AWB assignment
        }
      }

      return res.json({
        success: true,
        awb_code: awbCode,
        courier_company_id: courierCompanyId,
        courier_name: courierName,
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
