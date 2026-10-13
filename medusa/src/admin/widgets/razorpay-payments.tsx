import { defineWidgetConfig } from "@medusajs/admin-sdk"
import { Container, Heading, Text, Badge, Button } from "@medusajs/ui"
import { useEffect, useState, useCallback } from "react"

interface OrderData {
  id: string
  display_id: number
  fulfillment_status?: string
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
  refund_status?: string | null
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

// ── Refund Confirmation Dialog ──
const RefundDialog = ({
  payment,
  onClose,
  onRefunded,
}: {
  payment: RazorpayPayment
  onClose: () => void
  onRefunded: () => void
}) => {
  const [refunding, setRefunding] = useState(false)
  const [result, setResult] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isPartial, setIsPartial] = useState(false)
  const [partialAmount, setPartialAmount] = useState("")

  const refundableAmount = payment.amount - (payment.amount_refunded || 0)
  const feeLost = payment.fee || 0
  const taxLost = payment.tax || 0

  const handleRefund = async () => {
    setRefunding(true)
    setError(null)
    setResult(null)

    try {
      const body: Record<string, unknown> = {
        payment_id: payment.id,
        notes: { reason: "Fulfillment cancelled / Admin refund" },
      }

      if (isPartial && partialAmount) {
        const amountPaise = Math.round(parseFloat(partialAmount) * 100)
        if (isNaN(amountPaise) || amountPaise <= 0) {
          throw new Error("Please enter a valid refund amount")
        }
        if (amountPaise > refundableAmount) {
          throw new Error(`Amount exceeds refundable balance of ${formatINR(refundableAmount)}`)
        }
        body.amount = amountPaise
      }

      const res = await fetch("/admin/razorpay/refund", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(body),
      })

      const data = await res.json()

      if (!res.ok || !data.success) {
        throw new Error(data.error || "Refund failed")
      }

      setResult(
        `Refund ${data.refund.id} initiated — ${formatINR(data.refund.amount)} will be returned to customer in 5-7 business days.`
      )

      setTimeout(() => {
        onRefunded()
        onClose()
      }, 3000)
    } catch (e: any) {
      setError(e.message)
    } finally {
      setRefunding(false)
    }
  }

  const overlayStyle: React.CSSProperties = {
    position: "fixed",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    background: "rgba(0,0,0,0.5)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 9999,
  }

  const dialogStyle: React.CSSProperties = {
    background: "#FFFFFF",
    borderRadius: "12px",
    padding: "24px",
    maxWidth: "480px",
    width: "90%",
    boxShadow: "0 20px 60px rgba(0,0,0,0.2)",
  }

  const warningBoxStyle: React.CSSProperties = {
    background: "#FFF7ED",
    border: "1px solid #FDBA74",
    borderRadius: "8px",
    padding: "12px",
    marginBottom: "16px",
  }

  const summaryRowStyle: React.CSSProperties = {
    display: "flex",
    justifyContent: "space-between",
    padding: "6px 0",
    fontSize: "13px",
  }

  const inputStyle: React.CSSProperties = {
    width: "100%",
    padding: "8px 12px",
    border: "1px solid #D1D5DB",
    borderRadius: "6px",
    fontSize: "14px",
    marginTop: "8px",
  }

  return (
    <div style={overlayStyle} onClick={onClose}>
      <div style={dialogStyle} onClick={(e) => e.stopPropagation()}>
        <Heading level="h2" style={{ fontSize: "16px", marginBottom: "16px" }}>
          ⚠️ Confirm Razorpay Refund
        </Heading>

        {/* Warning about non-refundable fees */}
        <div style={warningBoxStyle}>
          <Text style={{ fontSize: "12px", color: "#9A3412", fontWeight: 600, marginBottom: "4px" }}>
            Razorpay Fees Are Non-Refundable
          </Text>
          <Text style={{ fontSize: "12px", color: "#9A3412" }}>
            The customer will receive the full refund. However, Razorpay will NOT refund their
            processing fee ({formatINR(feeLost)}) and GST ({formatINR(taxLost)}) to you.
          </Text>
        </div>

        {/* Refund summary */}
        <div style={{ background: "#F8FAFC", borderRadius: "8px", padding: "12px", marginBottom: "16px" }}>
          <div style={summaryRowStyle}>
            <span style={{ color: "#64748B" }}>Original Payment</span>
            <span style={{ fontWeight: 600 }}>{formatINR(payment.amount)}</span>
          </div>
          {(payment.amount_refunded || 0) > 0 && (
            <div style={summaryRowStyle}>
              <span style={{ color: "#64748B" }}>Already Refunded</span>
              <span style={{ color: "#DC2626" }}>-{formatINR(payment.amount_refunded || 0)}</span>
            </div>
          )}
          <div style={{ ...summaryRowStyle, borderTop: "1px solid #E2E8F0", paddingTop: "8px" }}>
            <span style={{ color: "#64748B", fontWeight: 600 }}>Refundable Balance</span>
            <span style={{ fontWeight: 700, color: "#0F172A" }}>{formatINR(refundableAmount)}</span>
          </div>
          <div style={summaryRowStyle}>
            <span style={{ color: "#DC2626", fontSize: "12px" }}>Fee you'll lose (non-refundable)</span>
            <span style={{ color: "#DC2626", fontSize: "12px" }}>{formatINR(feeLost + taxLost)}</span>
          </div>
        </div>

        {/* Partial vs Full toggle */}
        <div style={{ marginBottom: "16px" }}>
          <label style={{ display: "flex", alignItems: "center", gap: "8px", cursor: "pointer", fontSize: "13px" }}>
            <input
              type="checkbox"
              checked={isPartial}
              onChange={(e) => setIsPartial(e.target.checked)}
              style={{ width: "16px", height: "16px" }}
            />
            Partial refund (specify custom amount)
          </label>
          {isPartial && (
            <div style={{ marginTop: "8px" }}>
              <Text style={{ fontSize: "12px", color: "#64748B" }}>Amount in ₹ (max: {formatINR(refundableAmount)})</Text>
              <input
                type="number"
                step="0.01"
                min="1"
                max={refundableAmount / 100}
                placeholder={`e.g., ${refundableAmount / 100}`}
                value={partialAmount}
                onChange={(e) => setPartialAmount(e.target.value)}
                style={inputStyle}
              />
            </div>
          )}
        </div>

        {/* Result / Error */}
        {result && (
          <div style={{ background: "#F0FDF4", border: "1px solid #86EFAC", borderRadius: "8px", padding: "12px", marginBottom: "12px" }}>
            <Text style={{ fontSize: "13px", color: "#166534" }}>✅ {result}</Text>
          </div>
        )}
        {error && (
          <div style={{ background: "#FEF2F2", border: "1px solid #FCA5A5", borderRadius: "8px", padding: "12px", marginBottom: "12px" }}>
            <Text style={{ fontSize: "13px", color: "#DC2626" }}>❌ {error}</Text>
          </div>
        )}

        {/* Action buttons */}
        <div style={{ display: "flex", gap: "8px", justifyContent: "flex-end" }}>
          <Button variant="secondary" size="small" onClick={onClose} disabled={refunding}>
            Cancel
          </Button>
          <Button
            variant="danger"
            size="small"
            onClick={handleRefund}
            disabled={refunding || !!result}
          >
            {refunding ? "Processing…" : isPartial ? `Refund ₹${partialAmount || "?"}` : `Refund ${formatINR(refundableAmount)}`}
          </Button>
        </div>
      </div>
    </div>
  )
}

// ── Auto-Prompt Banner for Cancelled Fulfillments ──
const CancellationBanner = ({
  onRefundClick,
}: {
  onRefundClick: () => void
}) => {
  const bannerStyle: React.CSSProperties = {
    background: "linear-gradient(135deg, #FEF3C7, #FDE68A)",
    border: "1px solid #F59E0B",
    borderRadius: "8px",
    padding: "14px 16px",
    marginBottom: "16px",
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: "12px",
  }

  return (
    <div style={bannerStyle}>
      <div>
        <Text style={{ fontSize: "13px", fontWeight: 600, color: "#92400E" }}>
          ⚠️ Fulfillment Cancelled
        </Text>
        <Text style={{ fontSize: "12px", color: "#92400E", marginTop: "2px" }}>
          This order's fulfillment has been cancelled. Would you like to refund the Razorpay payment?
        </Text>
      </div>
      <Button variant="danger" size="small" onClick={onRefundClick}>
        Refund Payment
      </Button>
    </div>
  )
}

// ── Main Widget ──
const RazorpayPaymentsWidget = ({ data }: { data: OrderData }) => {
  const [payments, setPayments] = useState<RazorpayPayment[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [razorpayOrderId, setRazorpayOrderId] = useState<string | null>(null)
  const [refundTarget, setRefundTarget] = useState<RazorpayPayment | null>(null)
  const [dismissedBanner, setDismissedBanner] = useState(false)

  const isCancelled = data.fulfillment_status === "canceled" || data.fulfillment_status === "cancelled"

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

  // Find the first refundable payment (captured, not fully refunded)
  const refundablePayment = payments.find(
    (p) => p.status === "captured" && (p.amount_refunded || 0) < p.amount
  )

  // Styles
  const containerStyle: React.CSSProperties = { marginTop: "16px", padding: "0" }
  const headerStyle: React.CSSProperties = {
    display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "16px",
  }
  const headerLeftStyle: React.CSSProperties = { display: "flex", alignItems: "center", gap: "10px" }
  const cardStyle: React.CSSProperties = {
    border: "1px solid #E2E8F0", borderRadius: "8px", padding: "16px",
    marginBottom: "12px", background: "#FAFBFC",
  }
  const rowStyle: React.CSSProperties = {
    display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px",
  }
  const labelStyle: React.CSSProperties = { fontSize: "12px", color: "#64748B", fontWeight: 500 }
  const valueStyle: React.CSSProperties = { fontSize: "13px", color: "#1E293B", fontWeight: 500 }
  const amountStyle: React.CSSProperties = { fontSize: "18px", fontWeight: 700, color: "#0F172A" }
  const idStyle: React.CSSProperties = {
    fontSize: "11px", color: "#94A3B8", fontFamily: "monospace", cursor: "pointer",
  }
  const gridStyle: React.CSSProperties = {
    display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px", marginTop: "12px",
  }
  const gridItemStyle: React.CSSProperties = {
    background: "#F8FAFC", borderRadius: "6px", padding: "10px",
  }
  const feeRowStyle: React.CSSProperties = {
    display: "flex", justifyContent: "space-between", padding: "8px 0",
    borderTop: "1px solid #E2E8F0", marginTop: "8px",
  }

  if (!razorpayOrderId && !loading) {
    return (
      <Container style={containerStyle}>
        <div style={headerStyle}>
          <div style={headerLeftStyle}>
            <Heading level="h2" style={{ fontSize: "15px", fontWeight: 600 }}>
              💳 Razorpay Payments
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
      {/* Header */}
      <div style={headerStyle}>
        <div style={headerLeftStyle}>
          <Heading level="h2" style={{ fontSize: "15px", fontWeight: 600 }}>
            💳 Razorpay Payments
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
        <Button variant="secondary" size="small" onClick={fetchPayments} disabled={loading}>
          {loading ? "Loading…" : "Refresh"}
        </Button>
      </div>

      {/* Auto-prompt: fulfillment cancelled + has refundable payment */}
      {isCancelled && refundablePayment && !dismissedBanner && (
        <CancellationBanner
          onRefundClick={() => setRefundTarget(refundablePayment)}
        />
      )}

      {error && (
        <div style={{ border: "1px solid #FCA5A5", borderRadius: "8px", padding: "12px", background: "#FEF2F2", marginBottom: "12px" }}>
          <Text style={{ fontSize: "13px", color: "#DC2626" }}>{error}</Text>
        </div>
      )}

      {loading && payments.length === 0 && (
        <div style={{ textAlign: "center", padding: "24px" }}>
          <Text style={{ fontSize: "13px", color: "#94A3B8" }}>
            Fetching payment details from Razorpay…
          </Text>
        </div>
      )}

      {payments.map((p) => {
        const isRefundable = p.status === "captured" && (p.amount_refunded || 0) < p.amount
        const isFullyRefunded = (p.amount_refunded || 0) >= p.amount

        return (
          <div key={p.id} style={cardStyle}>
            {/* Amount + Status + Refund Button */}
            <div style={rowStyle}>
              <div>
                <span style={amountStyle}>{formatINR(p.amount)}</span>
                <span style={{ fontSize: "12px", color: "#94A3B8", marginLeft: "6px" }}>{p.currency}</span>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                {isRefundable && (
                  <Button
                    variant="danger"
                    size="small"
                    onClick={() => setRefundTarget(p)}
                  >
                    Refund
                  </Button>
                )}
                {isFullyRefunded && (
                  <Badge color="orange">FULLY REFUNDED</Badge>
                )}
                <Badge color={STATUS_COLORS[p.status] || "grey"}>
                  {p.status.toUpperCase()}
                </Badge>
              </div>
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
                <div style={{ ...valueStyle, fontSize: "12px", wordBreak: "break-all" as const }}>
                  {p.email || "—"}
                </div>
              </div>

              <div style={gridItemStyle}>
                <div style={labelStyle}>Phone</div>
                <div style={valueStyle}>{p.contact || "—"}</div>
              </div>
            </div>

            {/* Fee breakdown */}
            {(p.fee || p.tax) ? (
              <div style={feeRowStyle}>
                <div>
                  <span style={labelStyle}>Fee: </span>
                  <span style={{ ...valueStyle, fontSize: "12px" }}>{p.fee ? formatINR(p.fee) : "—"}</span>
                </div>
                <div>
                  <span style={labelStyle}>GST: </span>
                  <span style={{ ...valueStyle, fontSize: "12px" }}>{p.tax ? formatINR(p.tax) : "—"}</span>
                </div>
                <div>
                  <span style={labelStyle}>Net: </span>
                  <span style={{ ...valueStyle, fontSize: "12px", color: "#16A34A" }}>
                    {formatINR(p.amount - (p.fee || 0))}
                  </span>
                </div>
              </div>
            ) : null}

            {/* Refund info */}
            {p.refund_status && p.refund_status !== "null" && (
              <div style={{ ...feeRowStyle, borderColor: "#FCA5A5" }}>
                <div>
                  <span style={labelStyle}>Refund: </span>
                  <Badge color="orange">{p.refund_status.toUpperCase()}</Badge>
                </div>
                {(p.amount_refunded || 0) > 0 && (
                  <div>
                    <span style={labelStyle}>Refunded: </span>
                    <span style={{ ...valueStyle, color: "#DC2626" }}>
                      {formatINR(p.amount_refunded || 0)}
                    </span>
                  </div>
                )}
              </div>
            )}

            {/* Error info */}
            {p.error_code && (
              <div style={{ border: "1px solid #FCA5A5", borderRadius: "8px", padding: "12px", background: "#FEF2F2", marginTop: "8px" }}>
                <div style={labelStyle}>Error</div>
                <Text style={{ fontSize: "12px", color: "#DC2626" }}>
                  {p.error_code}: {p.error_description || "No description"}
                </Text>
              </div>
            )}
          </div>
        )
      })}

      {!loading && payments.length === 0 && !error && (
        <div style={{ textAlign: "center", padding: "24px", color: "#94A3B8" }}>
          <Text style={{ fontSize: "13px", color: "#94A3B8" }}>
            No payments found for this Razorpay order.
          </Text>
        </div>
      )}

      {/* Refund confirmation dialog */}
      {refundTarget && (
        <RefundDialog
          payment={refundTarget}
          onClose={() => {
            setRefundTarget(null)
            setDismissedBanner(true)
          }}
          onRefunded={fetchPayments}
        />
      )}
    </Container>
  )
}

export const config = defineWidgetConfig({
  zone: "order.details.after",
})

export default RazorpayPaymentsWidget
