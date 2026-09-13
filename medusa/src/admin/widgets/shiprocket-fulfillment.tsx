import { defineWidgetConfig } from "@medusajs/admin-sdk"
import { Container, Heading, Text, Badge, Button, Select, Tooltip } from "@medusajs/ui"
import { useEffect, useState, useCallback } from "react"

interface OrderData {
  id: string
  display_id: number
  fulfillment_status: string
  fulfillments?: Array<{
    id: string
    data?: Record<string, unknown>
    labels?: Array<{ tracking_number?: string }>
  }>
  shipping_address?: {
    postal_code?: string
    city?: string
    province?: string
  }
  metadata?: Record<string, unknown>
}

interface CourierOption {
  courier_company_id: number
  courier_name: string
  rate: number
  etd: string
  estimated_delivery_days: number
  is_surface: boolean
}

interface ShiprocketOrderData {
  order_id?: number
  shipment_id?: number
  awb_code?: string
  courier_name?: string
  status?: string
  channel_order_id?: string
}

type WidgetStep = "loading" | "no-fulfillment" | "checking-sr" | "select-courier" | "assigning" | "assigned" | "scheduling-pickup" | "pickup-done" | "error"

const ShiprocketWidget = ({ data }: { data: OrderData }) => {
  const [step, setStep] = useState<WidgetStep>("loading")
  const [error, setError] = useState("")
  const [couriers, setCouriers] = useState<CourierOption[]>([])
  const [selectedCourier, setSelectedCourier] = useState<string>("")
  const [srOrder, setSrOrder] = useState<ShiprocketOrderData | null>(null)
  const [awbInfo, setAwbInfo] = useState<{ awb_code?: string; courier_name?: string } | null>(null)
  const [pickupInfo, setPickupInfo] = useState<string | null>(null)

  const backendUrl = (window as Record<string, unknown>).__MEDUSA_BACKEND_URL__ as string || ""

  const adminFetch = useCallback(async (path: string, body?: Record<string, unknown>) => {
    const res = await fetch(`${backendUrl}/admin/shiprocket${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
    body: body ? JSON.stringify(body) : undefined,
    })
    return res.json()
  }, [backendUrl])

  // Step 1: Check if order is fulfilled
  useEffect(() => {
    if (!data.fulfillments || data.fulfillments.length === 0) {
      setStep("no-fulfillment")
      return
    }

    // Check if fulfillment has Shiprocket data
    const fulfillment = data.fulfillments[0]
    const srData = fulfillment?.data as ShiprocketOrderData | undefined

    if (srData?.shipment_id) {
      setSrOrder(srData)
      if (srData.awb_code) {
        setAwbInfo({ awb_code: srData.awb_code, courier_name: srData.courier_name })
        setStep("assigned")
      } else {
        setStep("checking-sr")
        loadCouriers()
      }
    } else {
      // Try to find the SR order by searching
      checkShiprocketOrder()
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data])

  const checkShiprocketOrder = async () => {
    setStep("checking-sr")
    try {
      const result = await adminFetch("/order-status", {
        channel_order_id: String(data.display_id),
      })

      if (result.success && result.data?.data) {
        const orders = Array.isArray(result.data.data) ? result.data.data : [result.data.data]
        const order = orders[0]
        if (order) {
          setSrOrder({
            order_id: order.id,
            shipment_id: order.shipments?.[0]?.id,
            awb_code: order.shipments?.[0]?.awb || order.awb_code,
            courier_name: order.shipments?.[0]?.courier_name || order.courier_name,
            status: order.status,
          })

          if (order.shipments?.[0]?.awb || order.awb_code) {
            setAwbInfo({
              awb_code: order.shipments?.[0]?.awb || order.awb_code,
              courier_name: order.shipments?.[0]?.courier_name || order.courier_name,
            })
            setStep("assigned")
            return
          }
        }
      }

      // No AWB yet — load courier options
      loadCouriers()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to check Shiprocket order")
      setStep("error")
    }
  }

  const loadCouriers = async () => {
    try {
      const postcode = data.shipping_address?.postal_code
      if (!postcode) {
        setError("No delivery postcode found on order")
        setStep("error")
        return
      }

      const result = await adminFetch("/couriers", {
        delivery_postcode: postcode,
        weight: 0.3,
        cod: 0,
      })

      if (result.success && result.couriers?.length > 0) {
        setCouriers(result.couriers)
        setSelectedCourier(String(result.couriers[0].courier_company_id))
        setStep("select-courier")
      } else {
        setError(`No couriers available for pincode ${postcode}`)
        setStep("error")
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load couriers")
      setStep("error")
    }
  }

  const handleAssignCourier = async () => {
    if (!srOrder?.shipment_id || !selectedCourier) return
    setStep("assigning")

    try {
      const result = await adminFetch("/assign-awb", {
        shipment_id: srOrder.shipment_id,
        courier_id: Number(selectedCourier),
      })

      if (result.success) {
        setAwbInfo({
          awb_code: result.awb_code,
          courier_name: result.courier_name,
        })
        setStep("assigned")
      } else {
        setError(result.error || "AWB assignment failed")
        setStep("error")
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to assign courier")
      setStep("error")
    }
  }

  const handleSchedulePickup = async () => {
    if (!srOrder?.shipment_id) return
    setStep("scheduling-pickup")

    try {
      const result = await adminFetch("/pickup", {
        shipment_id: srOrder.shipment_id,
      })

      if (result.success) {
        setPickupInfo(result.pickup_scheduled_date || "Scheduled")
        setStep("pickup-done")
      } else {
        setPickupInfo(result.message || "Pickup request submitted")
        setStep("pickup-done")
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to schedule pickup")
      setStep("error")
    }
  }

  // Don't show widget for unfulfilled orders
  if (step === "no-fulfillment") return null

  return (
    <Container className="p-0">
      <div style={{
        border: "2px solid #e4e4e7",
        borderRadius: "8px",
        overflow: "hidden",
      }}>
        {/* Header */}
        <div style={{
          background: "linear-gradient(135deg, #7C3AED 0%, #5B21B6 100%)",
          padding: "16px 20px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <span style={{ fontSize: "20px" }}>🚀</span>
            <Heading level="h2" style={{ color: "white", margin: 0 }}>
              Shiprocket Fulfillment
            </Heading>
          </div>
          {srOrder?.order_id && (
            <Badge color="purple" size="small">
              SR #{srOrder.order_id}
            </Badge>
          )}
        </div>

        {/* Content */}
        <div style={{ padding: "16px 20px" }}>
          {/* Loading */}
          {(step === "loading" || step === "checking-sr") && (
            <div style={{ textAlign: "center", padding: "20px" }}>
              <Text style={{ color: "#71717A" }}>
                ⏳ Checking Shiprocket order status...
              </Text>
            </div>
          )}

          {/* Error */}
          {step === "error" && (
            <div style={{
              background: "#FEF2F2",
              border: "1px solid #FCA5A5",
              borderRadius: "6px",
              padding: "12px 16px",
            }}>
              <Text style={{ color: "#DC2626" }}>❌ {error}</Text>
              <div style={{ marginTop: "8px" }}>
                <Button
                  variant="secondary"
                  size="small"
                  onClick={() => checkShiprocketOrder()}
                >
                  Retry
                </Button>
              </div>
            </div>
          )}

          {/* Courier Selection */}
          {step === "select-courier" && (
            <div>
              <Text style={{ marginBottom: "12px", fontWeight: 600 }}>
                Select a courier for delivery to {data.shipping_address?.city} ({data.shipping_address?.postal_code}):
              </Text>

              <div style={{
                border: "1px solid #E4E4E7",
                borderRadius: "6px",
                overflow: "hidden",
                marginBottom: "16px",
              }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "13px" }}>
                  <thead>
                    <tr style={{ background: "#F4F4F5" }}>
                      <th style={{ padding: "8px 12px", textAlign: "left" }}></th>
                      <th style={{ padding: "8px 12px", textAlign: "left" }}>Courier</th>
                      <th style={{ padding: "8px 12px", textAlign: "right" }}>Rate</th>
                      <th style={{ padding: "8px 12px", textAlign: "center" }}>ETD</th>
                      <th style={{ padding: "8px 12px", textAlign: "center" }}>Type</th>
                    </tr>
                  </thead>
                  <tbody>
                    {couriers.map((c, i) => (
                      <tr
                        key={c.courier_company_id}
                        style={{
                          background: selectedCourier === String(c.courier_company_id) ? "#F0F9FF" : "white",
                          borderTop: i > 0 ? "1px solid #E4E4E7" : "none",
                          cursor: "pointer",
                        }}
                        onClick={() => setSelectedCourier(String(c.courier_company_id))}
                      >
                        <td style={{ padding: "8px 12px" }}>
                          <input
                            type="radio"
                            name="courier"
                            checked={selectedCourier === String(c.courier_company_id)}
                            onChange={() => setSelectedCourier(String(c.courier_company_id))}
                          />
                        </td>
                        <td style={{ padding: "8px 12px", fontWeight: 500 }}>
                          {c.courier_name}
                          {i === 0 && (
                            <Badge color="green" size="small" style={{ marginLeft: "6px" }}>
                              Cheapest
                            </Badge>
                          )}
                        </td>
                        <td style={{ padding: "8px 12px", textAlign: "right", fontWeight: 600 }}>
                          ₹{c.rate.toFixed(2)}
                        </td>
                        <td style={{ padding: "8px 12px", textAlign: "center" }}>
                          {c.etd || `${c.estimated_delivery_days}d`}
                        </td>
                        <td style={{ padding: "8px 12px", textAlign: "center" }}>
                          <Badge color={c.is_surface ? "grey" : "blue"} size="small">
                            {c.is_surface ? "Surface" : "Air"}
                          </Badge>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <Button
                variant="primary"
                onClick={handleAssignCourier}
                disabled={!selectedCourier}
              >
                Assign Courier & Generate AWB
              </Button>
            </div>
          )}

          {/* Assigning */}
          {step === "assigning" && (
            <div style={{ textAlign: "center", padding: "20px" }}>
              <Text>⏳ Assigning courier and generating AWB...</Text>
            </div>
          )}

          {/* Assigned - Show AWB + Pickup option */}
          {step === "assigned" && awbInfo && (
            <div>
              <div style={{
                background: "#F0FDF4",
                border: "1px solid #86EFAC",
                borderRadius: "6px",
                padding: "12px 16px",
                marginBottom: "16px",
              }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <div>
                    <Text style={{ fontWeight: 600, color: "#166534" }}>
                      ✅ Courier Assigned
                    </Text>
                    <Text style={{ fontSize: "13px", marginTop: "4px" }}>
                      <strong>Courier:</strong> {awbInfo.courier_name}
                    </Text>
                    <Text style={{ fontSize: "13px" }}>
                      <strong>AWB:</strong> {awbInfo.awb_code}
                    </Text>
                  </div>
                  <Tooltip content="Track on Shiprocket">
                    <a
                      href={`https://shiprocket.co/tracking/${awbInfo.awb_code}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{ textDecoration: "none" }}
                    >
                      <Button variant="secondary" size="small">
                        🔗 Track
                      </Button>
                    </a>
                  </Tooltip>
                </div>
              </div>

              <Button variant="primary" onClick={handleSchedulePickup}>
                📦 Schedule Pickup
              </Button>
            </div>
          )}

          {/* Scheduling Pickup */}
          {step === "scheduling-pickup" && (
            <div style={{ textAlign: "center", padding: "20px" }}>
              <Text>⏳ Scheduling pickup...</Text>
            </div>
          )}

          {/* Pickup Done */}
          {step === "pickup-done" && (
            <div style={{
              background: "#F0FDF4",
              border: "1px solid #86EFAC",
              borderRadius: "6px",
              padding: "12px 16px",
            }}>
              <Text style={{ fontWeight: 600, color: "#166534" }}>
                ✅ All Done!
              </Text>
              {awbInfo && (
                <>
                  <Text style={{ fontSize: "13px", marginTop: "4px" }}>
                    <strong>Courier:</strong> {awbInfo.courier_name}
                  </Text>
                  <Text style={{ fontSize: "13px" }}>
                    <strong>AWB:</strong> {awbInfo.awb_code}
                  </Text>
                </>
              )}
              <Text style={{ fontSize: "13px" }}>
                <strong>Pickup:</strong> {pickupInfo}
              </Text>
              <div style={{ marginTop: "8px" }}>
                <a
                  href={`https://shiprocket.co/tracking/${awbInfo?.awb_code}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ textDecoration: "none" }}
                >
                  <Button variant="secondary" size="small">
                    🔗 Track Shipment
                  </Button>
                </a>
              </div>
            </div>
          )}
        </div>
      </div>
    </Container>
  )
}

export const config = defineWidgetConfig({
  zone: "order.details.after",
})

export default ShiprocketWidget
