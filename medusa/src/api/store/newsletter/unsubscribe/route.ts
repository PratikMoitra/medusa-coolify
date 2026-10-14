import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"

/**
 * POST /store/newsletter/unsubscribe
 *
 * Unsubscribes a customer from the newsletter using a secure token.
 * The token is generated when the customer subscribes and stored in
 * their metadata. This prevents anyone from unsubscribing others.
 *
 * Body: { token: string }
 */
export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  const { token } = req.body as { token?: string }

  if (!token || typeof token !== "string" || token.length < 16) {
    return res.status(400).json({ error: "Invalid unsubscribe token" })
  }

  try {
    const customerService = req.scope.resolve("customerModuleService") as any

    // Find the customer with this unsubscribe token
    // MedusaJS v2 doesn't support filtering by metadata directly,
    // so we list newsletter subscribers and match the token
    const [customers] = await customerService.listAndCountCustomers(
      {},
      { take: 1000, select: ["id", "email", "metadata"] }
    )

    const customer = customers.find(
      (c: any) => c.metadata?.unsubscribe_token === token
    )

    if (!customer) {
      return res.status(404).json({ error: "Invalid or expired unsubscribe link" })
    }

    if (customer.metadata?.newsletter_opt_in === false) {
      return res.json({
        success: true,
        message: "You're already unsubscribed.",
        email: customer.email,
      })
    }

    // Update metadata to mark as unsubscribed
    await customerService.updateCustomers(customer.id, {
      metadata: {
        ...customer.metadata,
        newsletter_opt_in: false,
        unsubscribed_at: new Date().toISOString(),
      },
    })

    const logger = req.scope.resolve("logger") as any
    logger.info(`[newsletter] ${customer.email} unsubscribed via token`)

    // Notify via Telegram
    const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN
    const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID
    if (TELEGRAM_BOT_TOKEN && TELEGRAM_CHAT_ID) {
      await fetch(
        `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            chat_id: TELEGRAM_CHAT_ID,
            text: `📭 <b>Newsletter Unsubscribe</b>\n\n📧 <code>${customer.email}</code>\n📅 ${new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}`,
            parse_mode: "HTML",
          }),
        }
      ).catch(() => {})
    }

    return res.json({
      success: true,
      message: "You've been unsubscribed. You won't receive any more marketing emails.",
      email: customer.email,
    })
  } catch (error: any) {
    const logger = req.scope.resolve("logger") as any
    logger.error(`[newsletter] Unsubscribe failed: ${error?.message}`)
    return res.status(500).json({ error: "Something went wrong. Please try again." })
  }
}
