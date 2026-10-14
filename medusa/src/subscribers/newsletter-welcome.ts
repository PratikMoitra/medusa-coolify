import type {
  SubscriberArgs,
  SubscriberConfig,
} from "@medusajs/framework"
import { SesNotificationService } from "../modules/ses-notification/service"
import { newsletterWelcomeEmail } from "../modules/ses-notification/templates"

let sesService: SesNotificationService | null = null

function getSesService(container: Record<string, any>): SesNotificationService {
  if (!sesService) {
    sesService = new SesNotificationService(container)
  }
  return sesService
}

export default async function newsletterWelcomeHandler({
  event,
  container,
}: SubscriberArgs<{ id: string }>) {
  const logger = container.resolve("logger") as any
  const customerService = container.resolve("customerModuleService") as any
  const promotionService = container.resolve("promotionModuleService") as any

  try {
    const customer = await customerService.retrieveCustomer(event.data.id)

    if (!customer?.metadata?.source?.startsWith("newsletter")) return
    if (customer.metadata?.subscriber_coupon_code) return

    const code = generateCouponCode()

    // Create a single-use 5% discount promotion tied to this subscriber's email
    try {
      await promotionService.createPromotions([{
        code,
        type: "standard",
        status: "active",
        is_automatic: false,
        application_method: {
          type: "percentage",
          value: 2,
          target_type: "order",
          allocation: "across",
          currency_code: "inr",
          max_quantity: 1,
        },
        rules: [
          {
            attribute: "customer.email",
            operator: "eq",
            values: [customer.email],
          },
        ],
      }])
      logger.info(`[newsletter] Created promotion ${code} for ${customer.email}`)
    } catch (promoErr: any) {
      logger.error(`[newsletter] Failed to create promotion: ${promoErr?.message}`)
      return
    }

    // Generate a secure unsubscribe token
    const unsubToken = generateToken(32)

    // Store coupon + unsubscribe token in customer metadata
    await customerService.updateCustomers(customer.id, {
      metadata: {
        ...customer.metadata,
        subscriber_coupon_code: code,
        coupon_generated_at: new Date().toISOString(),
        unsubscribe_token: unsubToken,
      },
    })

    // Send welcome email via AWS SES
    const storeUrl = process.env.STOREFRONT_URL || "https://chamkileystore.in"
    const ses = getSesService({ logger })
    const emailData = newsletterWelcomeEmail({
      email: customer.email,
      couponCode: code,
      storeName: "ChamkileyStore",
      storeUrl,
      unsubscribeUrl: `${storeUrl}/unsubscribe?token=${unsubToken}`,
    })

    const emailSent = await ses.sendEmail({
      to: customer.email,
      subject: emailData.subject,
      html: emailData.html,
      salesChannelName: "ChamkileyStore",
    })

    if (emailSent) {
      logger.info(`[newsletter] Welcome email sent to ${customer.email} with coupon ${code}`)
    } else {
      logger.warn(`[newsletter] Welcome email FAILED for ${customer.email} — coupon ${code} still valid`)
    }

    // Also notify store owner via Telegram
    const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN
    const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID

    if (TELEGRAM_BOT_TOKEN && TELEGRAM_CHAT_ID) {
      const msg = [
        `📬 <b>New Newsletter Subscriber</b>`,
        ``,
        `📧 Email: <code>${customer.email}</code>`,
        `🎟️ Coupon: <code>${code}</code>`,
        `💰 Discount: 2% off (stackable)`,
        `📩 Welcome email: ${emailSent ? "✅ Sent" : "❌ Failed"}`,
        `📅 ${new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}`,
      ].join("\n")

      await fetch(
        `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            chat_id: TELEGRAM_CHAT_ID,
            text: msg,
            parse_mode: "HTML",
          }),
        }
      ).catch(() => {})
    }
  } catch (error: any) {
    logger.error(`[newsletter] Failed to process subscriber: ${error?.message}`)
  }
}

function generateCouponCode(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
  let result = "CHAMKILEY-SUB-"
  for (let i = 0; i < 8; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length))
  }
  return result
}

function generateToken(length: number): string {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789"
  let token = ""
  for (let i = 0; i < length; i++) {
    token += chars.charAt(Math.floor(Math.random() * chars.length))
  }
  return token
}

export const config: SubscriberConfig = {
  event: "customer.created",
}
