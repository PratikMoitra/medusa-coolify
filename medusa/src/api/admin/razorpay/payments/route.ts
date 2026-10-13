import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"

/**
 * GET /admin/razorpay/payments
 *
 * Proxies Razorpay payment queries from the admin widget.
 * Supports:
 *   ?order_id=order_xxx      — fetch payments for a Razorpay order
 *   ?payment_id=pay_xxx      — fetch a single payment
 *   ?count=N                 — fetch recent N payments (default 10)
 */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const keyId = process.env.RAZORPAY_ID
  const keySecret = process.env.RAZORPAY_SECRET

  if (!keyId || !keySecret) {
    return res.status(500).json({
      error: "RAZORPAY_ID and RAZORPAY_SECRET env vars are required",
    })
  }

  const auth = Buffer.from(`${keyId}:${keySecret}`).toString("base64")
  const headers = { Authorization: `Basic ${auth}` }

  const { order_id, payment_id, count } = req.query as Record<string, string>

  try {
    // Single payment lookup
    if (payment_id) {
      const payRes = await fetch(
        `https://api.razorpay.com/v1/payments/${payment_id}`,
        { headers }
      )
      if (!payRes.ok) {
        const err = await payRes.json().catch(() => ({}))
        return res.status(payRes.status).json({ error: err })
      }
      const payment = await payRes.json()
      return res.json({ payment })
    }

    // Payments for a specific Razorpay order
    if (order_id) {
      const payRes = await fetch(
        `https://api.razorpay.com/v1/orders/${order_id}/payments`,
        { headers }
      )
      if (!payRes.ok) {
        const err = await payRes.json().catch(() => ({}))
        return res.status(payRes.status).json({ error: err })
      }
      const data = await payRes.json()
      const items = Array.isArray(data) ? data : data.items || []
      return res.json({ payments: items })
    }

    // Recent payments
    const limit = Math.min(Number(count) || 10, 50)
    const payRes = await fetch(
      `https://api.razorpay.com/v1/payments?count=${limit}`,
      { headers }
    )
    if (!payRes.ok) {
      const err = await payRes.json().catch(() => ({}))
      return res.status(payRes.status).json({ error: err })
    }
    const data = await payRes.json()
    return res.json({
      payments: data.items || [],
      count: data.count || 0,
    })
  } catch (err: any) {
    return res.status(500).json({ error: err.message })
  }
}
