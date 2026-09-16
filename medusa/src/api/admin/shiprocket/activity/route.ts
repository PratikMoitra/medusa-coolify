import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { shiprocketFetch } from "../auth"

interface ActivityBody {
  shiprocket_order_id?: number
  awb_code?: string
}

interface TrackingActivity {
  date?: string
  activity?: string
  location?: string
  status?: string
  sr_status?: string
}

interface TrackingResponse {
  tracking_data?: {
    track_status?: number
    shipment_status?: number
    shipment_track?: Array<{
      current_status?: string
      delivered_date?: string
      pickup_date?: string
      etd?: string
      courier_name?: string
    }>
    shipment_track_activities?: TrackingActivity[]
    error?: string
  }
}

interface OrderResponse {
  data?: {
    id?: number
    status?: string
    shipments?: Array<{
      id?: number
      awb?: string
      status?: string
      courier_name?: string
      created_at?: string
    }>
    activities?: Array<{
      date?: string
      activity?: string
      type?: string
    }>
  }
}

/**
 * POST /admin/shiprocket/activity
 * Get activity logs for a Shiprocket order
 */
export async function POST(req: MedusaRequest, res: MedusaResponse) {
  try {
    const { shiprocket_order_id, awb_code } = req.body as ActivityBody

    const activities: Array<{ date: string; activity: string; location?: string; status?: string }> = []

    // If we have an AWB, get detailed tracking activities
    if (awb_code) {
      const tracking = await shiprocketFetch<TrackingResponse>(
        `/courier/track/awb/${awb_code}`
      )

      if (tracking.tracking_data?.shipment_track_activities) {
        for (const act of tracking.tracking_data.shipment_track_activities) {
          activities.push({
            date: act.date || "",
            activity: act.activity || act.status || "Unknown activity",
            location: act.location || "",
            status: act.sr_status || act.status || "",
          })
        }
      }

      const shipment = tracking.tracking_data?.shipment_track?.[0]
      return res.json({
        success: true,
        current_status: shipment?.current_status,
        courier_name: shipment?.courier_name,
        etd: shipment?.etd,
        pickup_date: shipment?.pickup_date,
        delivered_date: shipment?.delivered_date,
        activities,
      })
    }

    // Fallback: get order-level info
    if (shiprocket_order_id) {
      const order = await shiprocketFetch<OrderResponse>(
        `/orders/show/${shiprocket_order_id}`
      )

      if (order.data?.activities) {
        for (const act of order.data.activities) {
          activities.push({
            date: act.date || "",
            activity: act.activity || act.type || "Unknown activity",
          })
        }
      }

      return res.json({
        success: true,
        status: order.data?.status,
        shipments: order.data?.shipments,
        activities,
      })
    }

    return res.status(400).json({ error: "shiprocket_order_id or awb_code required" })
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error"
    return res.status(500).json({ error: message })
  }
}
