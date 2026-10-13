import { defineWidgetConfig } from "@medusajs/admin-sdk"
import { Container, Heading, Text, Badge, Button } from "@medusajs/ui"
import { useEffect, useState, useCallback } from "react"

interface OrderData {
  id: string
  display_id: number
  payment_collections?: Array<{
    id: string
    amount: number
    currency_code: string
    payment_sessions?: Array<{
      id: string
      provider_id: string
      data?: {
        razorpayOrder?: { id: string; amount: number; currency: string; status: string }
        razorpay_order?: { id: string }
        id?: string
      }
    }>
    payments?: Array<{
      id: string
      amount: number
      provider_id: string
      data?: Record<string, unknown>
    }>
  }>
  metadata?: Record<string, unknown>
}

interface RazorpayPayment {
  id: string
  amount: number
  currency: string
  status: string
  method: string
  email: string
  contact: string
  order_id: string
  created_at: number
  captured_at?: number
  description?: string
  vpa?: string
  bank?: string
  wallet?: string
  card_id?: string
  card?: {
    last4?: string
    network?: string
    type?: string
    issuer?: string
  }
  notes?: Record<string, string>
  error_code?: string
  error_description?: string
  fee?: number
  tax?: number
  refund_status?: string
  amount_refunded?: number
}

const STATUS_COLORS: Record<string, "green" | "red" | "orange" | "blue" | "grey"> = {
  captured: "green",
  authorized: "blue",
  failed: "red",
  refunded: "orange",
  created: "grey",
}

function formatINR(paise: number): string {
  return `₹${(paise / 100).toLocaleString("en-IN", { minimumFractionDigits: 0 })}`
}

function formatTimestamp(ts: number): string {
  const d = new Date(ts * 1000)
  return d.toLocaleString("en-IN", {
    timeZone: "Asia/Kolkata",
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  })
}

const RazorpayPaymentsWidget = ({ data }: { data: OrderData }) => {
  const [payments, setPayments] = useState<RazorpayPayment[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [razorpayOrderId, setRazorpayOrderId] = useState<string | null>(null)

  const extractRazorpayOrderId = useCallback((): string | null => {
    if (!data.payment_collections) return null
    for (const pc of data.payment_collections) {
      for (const session of pc.payment_sessions || []) {
        const rpOrderId =
          session.data?.razorpayOrder?.id ||
          session.data?.razorpay_order?.id ||
          (typeof session.data?.id === "string" && session.data.id.startsWith("order_") ? session.data.id : null)
        if (rpOrderId) return rpOrderId
      }
      for (const payment of pc.payments || []) {
        const rpData = payment.data as Record<string, any> | undefined
        if (rpData?.razorpayOrder?.id) return rpData.razorpayOrder.id
        if (rpData?.razorpay_order?.id) return rpData.razorpay_order.id
      }
    }
    // Check metadata fallback
    const meta = data.metadata
    if (meta?.razorpay_order_id && typeof meta.razorpay_order_id === "string") {
      return meta.razorpay_order_id
    }
    return null
  }, [data])

  const fetchPayments = useCallback(async () => {
    setLoading(true)
    setError("")

    try {
      const rpOrderId = extractRazorpayOrderId()
      setRazorpayOrderId(rpOrderId)

      if (!rpOrderId) {
        setPayments([])
        setLoading(false)
        return
      }

      const res = await fetch(`/admin/razorpay/payments?order_id=${rpOrderId}`, {
        credentials: "include",
      })

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}))
        throw new Error(errData.error?.description || errData.error?.message || `HTTP ${res.status}`)
      }

      const result = await res.json()
      setPayments(result.payments || [])
    } catch (e: any) {
      setError(e.message || "Failed to fetch Razorpay payments")
    } finally {
      setLoading(false)
    }
  }, [extractRazorpayOrderId])

  useEffect(() => {
    fetchPayments()
  }, [fetchPayments])

  // Styles
  const containerStyle: React.CSSProperties = {
    marginTop: "16px",
    padding: "0",
  }

  const headerStyle: React.CSSProperties = {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: "16px",
  }

  const headerLeftStyle: React.CSSProperties = {
    display: "flex",
    alignItems: "center",
    gap: "10px",
  }

  const razorpayLogoStyle: React.CSSProperties = {
    width: "20px",
    height: "20px",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
  }

  const cardStyle: React.CSSProperties = {
    border: "1px solid #E2E8F0",
    borderRadius: "8px",
    padding: "16px",
    marginBottom: "12px",
    background: "#FAFBFC",
  }

  const rowStyle: React.CSSProperties = {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: "8px",
  }

  const labelStyle: React.CSSProperties = {
    fontSize: "12px",
    color: "#64748B",
    fontWeight: 500,
  }

  const valueStyle: React.CSSProperties = {
    fontSize: "13px",
    color: "#1E293B",
    fontWeight: 500,
  }

  const amountStyle: React.CSSProperties = {
    fontSize: "18px",
    fontWeight: 700,
    color: "#0F172A",
  }

  const idStyle: React.CSSProperties = {
    fontSize: "11px",
    color: "#94A3B8",
    fontFamily: "monospace",
    cursor: "pointer",
  }

  const gridStyle: React.CSSProperties = {
    display: "grid",
    gridTemplateColumns: "1fr 1fr",
    gap: "8px",
    marginTop: "12px",
  }

  const gridItemStyle: React.CSSProperties = {
    background: "#F8FAFC",
    borderRadius: "6px",
    padding: "10px",
  }

  const errorCardStyle: React.CSSProperties = {
    border: "1px solid #FCA5A5",
    borderRadius: "8px",
    padding: "12px",
    background: "#FEF2F2",
    marginTop: "8px",
  }

  const feeRowStyle: React.CSSProperties = {
    display: "flex",
    justifyContent: "space-between",
    padding: "8px 0",
    borderTop: "1px solid #E2E8F0",
    marginTop: "8px",
  }

  if (!razorpayOrderId && !loading) {
    return (
      <Container style={containerStyle}>
        <div style={headerStyle}>
          <div style={headerLeftStyle}>
            <div style={razorpayLogoStyle}>
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none">
                <path d="M22 9.67l-1.41-1.4L16 12.85 11.41 8.27 10 9.67l6 6z" fill="#2563EB" />
              </svg>
            </div>
            <Heading level="h2" style={{ fontSize: "15px", fontWeight: 600 }}>
              Razorpay Payments
            </Heading>
          </div>
        </div>
        <div style={{ textAlign: "center", padding: "24px", color: "#94A3B8" }}>
          <Text style={{ fontSize: "13px", color: "#94A3B8" }}>
            No Razorpay payment session found for this order.
          </Text>
        </div>
      </Container>
    )
  }

  return (
    <Container style={containerStyle}>
      <div style={headerStyle}>
        <div style={headerLeftStyle}>
          <div style={razorpayLogoStyle}>
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none">
              <path d="M22 9.67l-1.41-1.4L16 12.85 11.41 8.27 10 9.67l6 6z" fill="#2563EB" />
            </svg>
          </div>
          <Heading level="h2" style={{ fontSize: "15px", fontWeight: 600 }}>
            Razorpay Payments
          </Heading>
          {razorpayOrderId && (
            <Text
              style={{ ...idStyle, marginLeft: "4px" }}
              title="Click to copy"
              onClick={() => navigator.clipboard.writeText(razorpayOrderId)}
            >
              {razorpayOrderId}
            </Text>
          )}
        </div>
        <Button
          variant="secondary"
          size="small"
          onClick={fetchPayments}
          disabled={loading}
        >
          {loading ? "Loading…" : "Refresh"}
        </Button>
      </div>

      {error && (
        <div style={errorCardStyle}>
          <Text style={{ fontSize: "13px", color: "#DC2626" }}>
            {error}
          </Text>
        </div>
      )}

      {loading && payments.length === 0 && (
        <div style={{ textAlign: "center", padding: "24px" }}>
          <Text style={{ fontSize: "13px", color: "#94A3B8" }}>
            Fetching payment details from Razorpay…
          </Text>
        </div>
      )}

      {payments.map((p) => (
        <div key={p.id} style={cardStyle}>
          {/* Amount + Status */}
          <div style={rowStyle}>
            <div>
              <span style={amountStyle}>{formatINR(p.amount)}</span>
              <span style={{ fontSize: "12px", color: "#94A3B8", marginLeft: "6px" }}>
                {p.currency}
              </span>
            </div>
            <Badge color={STATUS_COLORS[p.status] || "grey"}>
              {p.status.toUpperCase()}
            </Badge>
          </div>

          {/* Payment ID */}
          <div style={{ marginBottom: "12px" }}>
            <Text
              style={idStyle}
              title="Click to copy payment ID"
              onClick={() => navigator.clipboard.writeText(p.id)}
            >
              {p.id}
            </Text>
          </div>

          {/* Payment Details Grid */}
          <div style={gridStyle}>
            <div style={gridItemStyle}>
              <div style={labelStyle}>Method</div>
              <div style={valueStyle}>
                {p.method === "upi" && p.vpa
                  ? `UPI (${p.vpa})`
                  : p.method === "card" && p.card
                    ? `${p.card.network || "Card"} •••• ${p.card.last4 || "?"}`
                    : p.method === "wallet"
                      ? `Wallet (${p.wallet || "?"})`
                      : p.method === "netbanking"
                        ? `Net Banking (${p.bank || "?"})`
                        : p.method?.toUpperCase() || "—"}
              </div>
            </div>

            <div style={gridItemStyle}>
              <div style={labelStyle}>Time</div>
              <div style={valueStyle}>
                {p.created_at ? formatTimestamp(p.created_at) : "—"}
              </div>
            </div>

            <div style={gridItemStyle}>
              <div style={labelStyle}>Email</div>
              <div style={{ ...valueStyle, fontSize: "12px", wordBreak: "break-all" }}>
                {p.email || "—"}
              </div>
            </div>

            <div style={gridItemStyle}>
              <div style={labelStyle}>Phone</div>
              <div style={valueStyle}>
                {p.contact || "—"}
              </div>
            </div>
          </div>

          {/* Razorpay fee breakdown */}
          {(p.fee || p.tax) && (
            <div style={feeRowStyle}>
              <div>
                <span style={labelStyle}>Razorpay Fee: </span>
                <span style={{ ...valueStyle, fontSize: "12px" }}>
                  {p.fee ? formatINR(p.fee) : "—"}
                </span>
              </div>
              <div>
                <span style={labelStyle}>GST: </span>
                <span style={{ ...valueStyle, fontSize: "12px" }}>
                  {p.tax ? formatINR(p.tax) : "—"}
                </span>
              </div>
              <div>
                <span style={labelStyle}>Net: </span>
                <span style={{ ...valueStyle, fontSize: "12px", color: "#16A34A" }}>
                  {formatINR(p.amount - (p.fee || 0))}
                </span>
              </div>
            </div>
          )}

          {/* Refund info */}
          {p.refund_status && p.refund_status !== "null" && (
            <div style={{ ...feeRowStyle, borderColor: "#FCA5A5" }}>
              <div>
                <span style={labelStyle}>Refund Status: </span>
                <Badge color="orange">{p.refund_status.toUpperCase()}</Badge>
              </div>
              {p.amount_refunded ? (
                <div>
                  <span style={labelStyle}>Refunded: </span>
                  <span style={{ ...valueStyle, color: "#DC2626" }}>
                    {formatINR(p.amount_refunded)}
                  </span>
                </div>
              ) : null}
            </div>
          )}

          {/* Error info for failed payments */}
          {p.error_code && (
            <div style={errorCardStyle}>
              <div style={labelStyle}>Error</div>
              <Text style={{ fontSize: "12px", color: "#DC2626" }}>
                {p.error_code}: {p.error_description || "No description"}
              </Text>
            </div>
          )}
        </div>
      ))}

      {!loading && payments.length === 0 && !error && (
        <div style={{ textAlign: "center", padding: "24px", color: "#94A3B8" }}>
          <Text style={{ fontSize: "13px", color: "#94A3B8" }}>
            No payments found for this Razorpay order.
          </Text>
        </div>
      )}
    </Container>
  )
}

export const config = defineWidgetConfig({
  zone: "order.details.after",
})

export default RazorpayPaymentsWidget
