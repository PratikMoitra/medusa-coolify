import { defineWidgetConfig } from "@medusajs/admin-sdk"
import { Container, Heading, Text, Badge, Button, Tooltip } from "@medusajs/ui"
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
  awb?: string
  tracking_number?: string
}

interface ActivityEntry {
  date: string
  activity: string
  location?: string
  status?: string
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

  // Wallet
  const [walletBalance, setWalletBalance] = useState<number | null>(null)
  const [isRefreshing, setIsRefreshing] = useState(false)

  // Activity logs
  const [activities, setActivities] = useState<ActivityEntry[]>([])
  const [showActivities, setShowActivities] = useState(false)
  const [loadingActivities, setLoadingActivities] = useState(false)
  const [currentStatus, setCurrentStatus] = useState<string | null>(null)

  const backendUrl = (window as Record<string, unknown>).__MEDUSA_BACKEND_URL__ as string || ""

  const adminFetch = useCallback(async (path: string, options?: { method?: string; body?: Record<string, unknown> }) => {
    const res = await fetch(`${backendUrl}/admin/shiprocket${path}`, {
      method: options?.method || (options?.body ? "POST" : "GET"),
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: options?.body ? JSON.stringify(options.body) : undefined,
    })
    return res.json()
  }, [backendUrl])

  // Reusable wallet balance fetcher
  const fetchWalletBalance = useCallback(async () => {
    try {
      const result = await adminFetch("/wallet", { method: "GET" })
      if (result.success) setWalletBalance(Number(result.balance) || 0)
    } catch {}
  }, [adminFetch])

  // Load wallet balance on mount
  useEffect(() => {
    fetchWalletBalance()
  }, [fetchWalletBalance])

  // Refresh all: wallet + order status
  const handleRefresh = useCallback(async () => {
    setIsRefreshing(true)
    try {
      await fetchWalletBalance()
      // Re-fetch Shiprocket order status if we have an order_id
      if (srOrder?.order_id) {
        const result = await adminFetch("/order-status", {
          method: "POST",
          body: { shiprocket_order_id: srOrder.order_id },
        })
        if (result.data) {
          const orders = Array.isArray(result.data.data) ? result.data.data : [result.data.data]
          const order = orders[0]
          if (order) {
            const shipments = Array.isArray(order.shipments) ? order.shipments : order.shipments ? [order.shipments] : []
            const shipment = shipments[0]
            setCurrentStatus(order.status || null)
            setSrOrder(prev => ({
              ...prev,
              status: order.status,
              awb_code: shipment?.awb || order.awb_code || prev?.awb_code,
              courier_name: shipment?.courier_name || order.courier_name || prev?.courier_name,
            }))
          }
        }
      }
    } catch {}
    setIsRefreshing(false)
  }, [adminFetch, fetchWalletBalance, srOrder?.order_id])

  // Step 1: Check if order is fulfilled
  useEffect(() => {
    if (!data.fulfillments || data.fulfillments.length === 0) {
      setStep("no-fulfillment")
      return
    }

    const fulfillment = data.fulfillments[0]
    const srData = fulfillment?.data as ShiprocketOrderData | undefined

    if (srData?.shipment_id) {
      setSrOrder(srData)
      const awb = srData.awb_code || srData.awb || srData.tracking_number
      if (awb) {
        setAwbInfo({ awb_code: awb, courier_name: srData.courier_name })
        setStep("assigned")
      } else {
        setStep("checking-sr")
        loadCouriers()
      }
    } else {
      checkShiprocketOrder()
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data])

  const checkShiprocketOrder = async () => {
    setStep("checking-sr")
    try {
      const result = await adminFetch("/order-status", {
        body: { channel_order_id: String(data.display_id) },
      })

      if (result.success && result.data?.data) {
        const orders = Array.isArray(result.data.data) ? result.data.data : [result.data.data]
        const order = orders[0]
        if (order) {
          const shipments = Array.isArray(order.shipments) ? order.shipments : order.shipments ? [order.shipments] : []
          const shipment = shipments[0]
          setSrOrder({
            order_id: order.id,
            shipment_id: shipment?.id,
            awb_code: shipment?.awb || order.awb_code,
            courier_name: shipment?.courier_name || order.courier_name,
            status: order.status,
          })

          if (shipment?.awb || order.awb_code) {
            setAwbInfo({
              awb_code: shipment?.awb || order.awb_code,
              courier_name: shipment?.courier_name || order.courier_name,
            })
            setStep("assigned")
            return
          }
        }
      }

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
        body: { delivery_postcode: postcode, weight: 0.3, cod: 0 },
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
        body: { shipment_id: srOrder.shipment_id, courier_id: Number(selectedCourier) },
      })

      if (result.success) {
        setAwbInfo({ awb_code: result.awb_code, courier_name: result.courier_name })
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
        body: { shipment_id: srOrder.shipment_id },
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

  const loadActivities = async () => {
    if (activities.length > 0) {
      setShowActivities(!showActivities)
      return
    }

    setLoadingActivities(true)
    try {
      const awb = awbInfo?.awb_code
      const body: Record<string, unknown> = {}
      if (awb) body.awb_code = awb
      else if (srOrder?.order_id) body.shiprocket_order_id = srOrder.order_id

      const result = await adminFetch("/activity", { body })

      if (result.success) {
        setActivities(result.activities || [])
        if (result.current_status) setCurrentStatus(result.current_status)
        setShowActivities(true)
      }
    } catch {
      // silently fail
    } finally {
      setLoadingActivities(false)
    }
  }

  if (step === "no-fulfillment") return null

  return (
    <Container className="p-0">
      <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
      <div style={{ border: "2px solid #e4e4e7", borderRadius: "8px", overflow: "hidden" }}>
        {/* Header */}
        <div style={{
          background: "linear-gradient(135deg, #7C3AED 0%, #5B21B6 100%)",
          padding: "16px 20px",
        }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              <span style={{ fontSize: "20px" }}>🚀</span>
              <Heading level="h2" style={{ color: "white", margin: 0 }}>
                Shiprocket Fulfillment
              </Heading>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              <button
                onClick={handleRefresh}
                disabled={isRefreshing}
                title="Refresh status & wallet"
                style={{
                  background: "rgba(255,255,255,0.15)",
                  border: "1px solid rgba(255,255,255,0.25)",
                  borderRadius: "6px",
                  padding: "6px 12px",
                  cursor: isRefreshing ? "wait" : "pointer",
                  color: "white",
                  fontSize: "12px",
                  fontWeight: 500,
                  display: "flex",
                  alignItems: "center",
                  gap: "6px",
                  transition: "all 0.2s ease",
                  opacity: isRefreshing ? 0.7 : 1,
                  letterSpacing: "0.02em",
                }}
              >
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  style={{
                    animation: isRefreshing ? "spin 0.8s linear infinite" : "none",
                  }}
                >
                  <path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8" />
                  <path d="M21 3v5h-5" />
                </svg>
                {isRefreshing ? "Refreshing" : "Refresh"}
              </button>
              {srOrder?.order_id && (
                <Badge color="purple" size="small">
                  SR #{srOrder.order_id}
                </Badge>
              )}
            </div>
          </div>

          {/* Wallet Balance Bar */}
          <div style={{
            marginTop: "10px",
            display: "flex",
            alignItems: "center",
            gap: "12px",
            padding: "8px 12px",
            background: "rgba(255,255,255,0.15)",
            borderRadius: "6px",
          }}>
            <span style={{ fontSize: "14px" }}>💰</span>
            <Text style={{ color: "white", fontSize: "13px", fontWeight: 600 }}>
              Wallet Balance:
            </Text>
            <Text style={{
              color: walletBalance !== null && walletBalance < 100 ? "#FCA5A5" : "#86EFAC",
              fontSize: "15px",
              fontWeight: 700,
            }}>
              {walletBalance !== null ? `₹${Number(walletBalance ?? 0).toFixed(2)}` : "Loading..."}
            </Text>
            {walletBalance !== null && walletBalance < 100 && (
              <Badge color="red" size="small">Low Balance</Badge>
            )}
          </div>
        </div>

        {/* Content */}
        <div style={{ padding: "16px 20px" }}>
          {/* Loading */}
          {(step === "loading" || step === "checking-sr") && (
            <div style={{ textAlign: "center", padding: "20px" }}>
              <Text style={{ color: "#71717A" }}>⏳ Checking Shiprocket order status...</Text>
            </div>
          )}

          {/* Error */}
          {step === "error" && (
            <div style={{ background: "#FEF2F2", border: "1px solid #FCA5A5", borderRadius: "6px", padding: "12px 16px" }}>
              <Text style={{ color: "#DC2626" }}>❌ {error}</Text>
              <div style={{ marginTop: "8px" }}>
                <Button variant="secondary" size="small" onClick={() => checkShiprocketOrder()}>Retry</Button>
              </div>
            </div>
          )}

          {/* Courier Selection */}
          {step === "select-courier" && (
            <div>
              <Text style={{ marginBottom: "12px", fontWeight: 600 }}>
                Select a courier for delivery to {data.shipping_address?.city} ({data.shipping_address?.postal_code}):
              </Text>

              <div style={{ border: "1px solid #E4E4E7", borderRadius: "6px", overflow: "hidden", marginBottom: "16px" }}>
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
                          {i === 0 && <Badge color="green" size="small" style={{ marginLeft: "6px" }}>Cheapest</Badge>}
                        </td>
                        <td style={{ padding: "8px 12px", textAlign: "right", fontWeight: 600 }}>₹{Number(c.rate ?? 0).toFixed(2)}</td>
                        <td style={{ padding: "8px 12px", textAlign: "center" }}>{c.etd || `${c.estimated_delivery_days}d`}</td>
                        <td style={{ padding: "8px 12px", textAlign: "center" }}>
                          <Badge color={c.is_surface ? "grey" : "blue"} size="small">{c.is_surface ? "Surface" : "Air"}</Badge>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <Button variant="primary" onClick={handleAssignCourier} disabled={!selectedCourier}>
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

          {/* Assigned */}
          {step === "assigned" && awbInfo && (
            <div>
              <div style={{ background: "#F0FDF4", border: "1px solid #86EFAC", borderRadius: "6px", padding: "12px 16px", marginBottom: "16px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <div>
                    <Text style={{ fontWeight: 600, color: "#166534" }}>✅ Courier Assigned</Text>
                    <Text style={{ fontSize: "13px", marginTop: "4px" }}>
                      <strong>Courier:</strong> {awbInfo.courier_name}
                    </Text>
                    <Text style={{ fontSize: "13px" }}>
                      <strong>AWB:</strong> {awbInfo.awb_code}
                    </Text>
                    {currentStatus && (
                      <Text style={{ fontSize: "13px" }}>
                        <strong>Status:</strong> {currentStatus}
                      </Text>
                    )}
                  </div>
                  <Tooltip content="Track on Shiprocket">
                    <a href={`https://shiprocket.co/tracking/${awbInfo.awb_code}`} target="_blank" rel="noopener noreferrer" style={{ textDecoration: "none" }}>
                      <Button variant="secondary" size="small">🔗 Track</Button>
                    </a>
                  </Tooltip>
                </div>
              </div>

              <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                <Button variant="primary" onClick={handleSchedulePickup}>📦 Schedule Pickup</Button>
                <Button variant="secondary" onClick={loadActivities} disabled={loadingActivities}>
                  {loadingActivities ? "⏳ Loading..." : showActivities ? "🔽 Hide Activity" : "📋 Show Activity Log"}
                </Button>
              </div>
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
            <div>
              <div style={{ background: "#F0FDF4", border: "1px solid #86EFAC", borderRadius: "6px", padding: "12px 16px" }}>
                <Text style={{ fontWeight: 600, color: "#166534" }}>✅ All Done!</Text>
                {awbInfo && (
                  <>
                    <Text style={{ fontSize: "13px", marginTop: "4px" }}><strong>Courier:</strong> {awbInfo.courier_name}</Text>
                    <Text style={{ fontSize: "13px" }}><strong>AWB:</strong> {awbInfo.awb_code}</Text>
                  </>
                )}
                <Text style={{ fontSize: "13px" }}><strong>Pickup:</strong> {pickupInfo}</Text>
                <div style={{ marginTop: "8px", display: "flex", gap: "8px" }}>
                  <a href={`https://shiprocket.co/tracking/${awbInfo?.awb_code}`} target="_blank" rel="noopener noreferrer" style={{ textDecoration: "none" }}>
                    <Button variant="secondary" size="small">🔗 Track Shipment</Button>
                  </a>
                  <Button variant="secondary" size="small" onClick={loadActivities} disabled={loadingActivities}>
                    {loadingActivities ? "⏳" : "📋 Activity Log"}
                  </Button>
                </div>
              </div>
            </div>
          )}

          {/* Activity Log Panel */}
          {showActivities && activities.length > 0 && (
            <div style={{
              marginTop: "16px",
              border: "1px solid #E4E4E7",
              borderRadius: "6px",
              overflow: "hidden",
            }}>
              <div style={{
                background: "#F8FAFC",
                padding: "10px 16px",
                borderBottom: "1px solid #E4E4E7",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
              }}>
                <Text style={{ fontWeight: 600, fontSize: "13px" }}>📋 Activity Log ({activities.length} events)</Text>
                <Button variant="secondary" size="small" onClick={() => setShowActivities(false)}>Hide</Button>
              </div>
              <div style={{ maxHeight: "300px", overflowY: "auto" }}>
                {activities.map((act, i) => (
                  <div
                    key={i}
                    style={{
                      padding: "10px 16px",
                      borderBottom: i < activities.length - 1 ? "1px solid #F1F5F9" : "none",
                      display: "flex",
                      gap: "12px",
                      fontSize: "12px",
                    }}
                  >
                    <div style={{
                      minWidth: "8px",
                      maxWidth: "8px",
                      height: "8px",
                      borderRadius: "50%",
                      background: i === 0 ? "#22C55E" : "#CBD5E1",
                      marginTop: "4px",
                      flexShrink: 0,
                    }} />
                    <div style={{ flex: 1 }}>
                      <Text style={{ fontSize: "12px", fontWeight: 500 }}>{act.activity}</Text>
                      <div style={{ display: "flex", gap: "8px", marginTop: "2px" }}>
                        {act.date && (
                          <Text style={{ fontSize: "11px", color: "#94A3B8" }}>{act.date}</Text>
                        )}
                        {act.location && (
                          <Text style={{ fontSize: "11px", color: "#94A3B8" }}>📍 {act.location}</Text>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {showActivities && activities.length === 0 && !loadingActivities && (
            <div style={{ marginTop: "12px", textAlign: "center", padding: "16px", color: "#94A3B8" }}>
              <Text style={{ fontSize: "13px", color: "#94A3B8" }}>No activity logs found yet.</Text>
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
