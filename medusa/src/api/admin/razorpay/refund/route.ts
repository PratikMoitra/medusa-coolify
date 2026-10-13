import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"

/**
 * POST /admin/razorpay/refund
 *
 * Initiates a refund on Razorpay for a captured payment.
 *
 * Body:
 *   payment_id: string   — Razorpay payment ID (pay_xxx)
 *   amount?: number      — Amount in paise to refund (partial). Omit for full refund.
 *   notes?: object       — Optional notes to attach to the refund
 *
 * Razorpay refund rules:
 *   - Customer gets the FULL refund amount back
 *   - Razorpay does NOT refund their MDR fee + GST to the merchant
 *   - No additional charge for processing the refund
 *   - Refund can take 5-7 business days to reflect in customer's account
 *   - Both full and partial refunds are supported
 */
export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const keyId = process.env.RAZORPAY_ID
  const keySecret = process.env.RAZORPAY_SECRET

  if (!keyId || !keySecret) {
    return res.status(500).json({
      error: "RAZORPAY_ID and RAZORPAY_SECRET env vars are required",
    })
  }

  const body = req.body as {
    payment_id?: string
    amount?: number
    notes?: Record<string, string>
  }

  const { payment_id, amount, notes } = body || {}

  if (!payment_id) {
    return res.status(400).json({ error: "payment_id is required" })
  }

  const auth = Buffer.from(`${keyId}:${keySecret}`).toString("base64")

  try {
    // First verify the payment is captured
    const payRes = await fetch(
      `https://api.razorpay.com/v1/payments/${payment_id}`,
      { headers: { Authorization: `Basic ${auth}` } }
    )

    if (!payRes.ok) {
      return res.status(payRes.status).json({
        error: "Unable to fetch payment from Razorpay",
      })
    }

    const payment = await payRes.json()

    if (payment.status !== "captured") {
      return res.status(400).json({
        error: `Payment is not in captured state (current: ${payment.status}). Only captured payments can be refunded.`,
      })
    }

    // Check if already fully refunded
    if (payment.amount_refunded >= payment.amount) {
      return res.status(400).json({
        error: "Payment has already been fully refunded",
      })
    }

    // Build refund request body
    const refundBody: Record<string, unknown> = {}

    if (amount) {
      // Partial refund — amount in paise
      if (amount > payment.amount - payment.amount_refunded) {
        return res.status(400).json({
          error: `Refund amount (${amount} paise) exceeds refundable amount (${payment.amount - payment.amount_refunded} paise)`,
        })
      }
      refundBody.amount = amount
    }

    if (notes) {
      refundBody.notes = notes
    }

    // Issue the refund
    const refundRes = await fetch(
      `https://api.razorpay.com/v1/payments/${payment_id}/refund`,
      {
        method: "POST",
        headers: {
          Authorization: `Basic ${auth}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(refundBody),
      }
    )

    if (!refundRes.ok) {
      const errData = await refundRes.json().catch(() => ({}))
      return res.status(refundRes.status).json({
        error: errData.error?.description || `Razorpay refund failed (HTTP ${refundRes.status})`,
        details: errData,
      })
    }

    const refund = await refundRes.json()

    return res.json({
      success: true,
      refund: {
        id: refund.id,
        amount: refund.amount,
        currency: refund.currency,
        status: refund.status,
        speed_requested: refund.speed_requested,
        created_at: refund.created_at,
      },
      payment: {
        id: payment_id,
        original_amount: payment.amount,
        amount_refunded: (payment.amount_refunded || 0) + (amount || payment.amount),
        fee_lost: payment.fee || 0,
        tax_lost: payment.tax || 0,
      },
    })
  } catch (err: any) {
    return res.status(500).json({ error: err.message })
  }
}
