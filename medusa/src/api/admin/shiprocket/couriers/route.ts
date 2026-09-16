import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { shiprocketFetch, getPickupPostcode } from "../auth"

interface CourierBody {
  delivery_postcode: string
  weight?: number
  cod?: number
}

interface CourierCompany {
  courier_company_id: number
  courier_name: string
  rate: number
  etd: string
  estimated_delivery_days: number
  min_weight: number
  charge_weight: number
  cod_charges: number
  freight_charge: number
  is_surface: boolean
}

interface ServiceabilityResponse {
  data?: {
    available_courier_companies?: CourierCompany[]
  }
  status?: number
}

/**
 * POST /admin/shiprocket/couriers
 * Check available couriers for a delivery pincode
 */
export async function POST(req: MedusaRequest, res: MedusaResponse) {
  try {
    const { delivery_postcode, weight = 0.5, cod = 0 } = req.body as CourierBody

    if (!delivery_postcode) {
      return res.status(400).json({ error: "delivery_postcode is required" })
    }

    const pickup_postcode = getPickupPostcode()

    const data = await shiprocketFetch<ServiceabilityResponse>(
      "/courier/serviceability", {
        params: {
          pickup_postcode,
          delivery_postcode,
          weight: String(weight),
          cod: String(cod),
        },
      }
    )

    const couriers = data.data?.available_courier_companies || []

    // Sort by rate (cheapest first)
    const sorted = couriers
      .map((c) => ({
        courier_company_id: c.courier_company_id,
        courier_name: c.courier_name,
        rate: c.rate,
        etd: c.etd,
        estimated_delivery_days: c.estimated_delivery_days,
        charge_weight: c.charge_weight,
        freight_charge: c.freight_charge,
        cod_charges: c.cod_charges,
        is_surface: c.is_surface,
      }))
      .sort((a, b) => a.rate - b.rate)

    return res.json({
      success: true,
      pickup_postcode,
      delivery_postcode,
      couriers: sorted,
      count: sorted.length,
    })
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error"
    return res.status(500).json({ error: message })
  }
}
