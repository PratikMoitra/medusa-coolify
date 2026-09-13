import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { shiprocketFetch } from "../auth"

interface WalletResponse {
  data?: {
    balance_amount?: number
    last_recharge_amount?: number
    last_recharge_date?: string
  }
}

/**
 * GET /admin/shiprocket/wallet
 * Get Shiprocket wallet balance
 */
export async function GET(_req: MedusaRequest, res: MedusaResponse) {
  try {
    const data = await shiprocketFetch<WalletResponse>("/account/details/wallet-balance")

    return res.json({
      success: true,
      balance: data.data?.balance_amount ?? 0,
      last_recharge_amount: data.data?.last_recharge_amount,
      last_recharge_date: data.data?.last_recharge_date,
    })
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error"
    return res.status(500).json({ error: message })
  }
}
