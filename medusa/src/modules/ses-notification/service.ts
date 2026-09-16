import { SESClient, SendEmailCommand } from "@aws-sdk/client-ses"

/**
 * SES Notification Service
 *
 * Sends transactional emails via Amazon SES with per-sales-channel
 * sender addresses.
 *
 * Env vars:
 *   AWS_SES_REGION           — SES region (e.g., ap-south-1)
 *   AWS_SES_ACCESS_KEY_ID    — IAM access key with ses:SendEmail permission
 *   AWS_SES_SECRET_ACCESS_KEY — IAM secret key
 *   SES_FROM_CHAMKILEY       — Sender for Chamkiley (e.g., "Chamkiley Store <noreply@chamkileystore.com>")
 *   SES_FROM_KALAKAVYA       — Sender for Kalakavya (e.g., "Kalakavya <noreply@kalakavya.com>")
 *   SES_FROM_DEFAULT         — Fallback sender if sales channel can't be determined
 */

export interface EmailPayload {
  to: string
  subject: string
  html: string
  salesChannelName?: string
}

export class SesNotificationService {
  private client: SESClient
  private senders: Record<string, string>
  private defaultSender: string
  private logger: any

  constructor(container: Record<string, any>) {
    this.logger = container.logger ?? console

    const region = process.env.AWS_SES_REGION
    const accessKeyId = process.env.AWS_SES_ACCESS_KEY_ID
    const secretAccessKey = process.env.AWS_SES_SECRET_ACCESS_KEY

    if (!region || !accessKeyId || !secretAccessKey) {
      this.logger.warn(
        "[ses-notification] Missing AWS SES credentials — emails will NOT be sent. " +
        "Set AWS_SES_REGION, AWS_SES_ACCESS_KEY_ID, AWS_SES_SECRET_ACCESS_KEY"
      )
    }

    this.client = new SESClient({
      region: region || "ap-south-1",
      credentials:
        accessKeyId && secretAccessKey
          ? { accessKeyId, secretAccessKey }
          : undefined,
    })

    // Map sales channel names (lowercased) to sender addresses
    this.senders = {}
    if (process.env.SES_FROM_CHAMKILEY) {
      this.senders["chamkileystore"] = process.env.SES_FROM_CHAMKILEY
      this.senders["chamkiley"] = process.env.SES_FROM_CHAMKILEY
    }
    if (process.env.SES_FROM_KALAKAVYA) {
      this.senders["kalakavya"] = process.env.SES_FROM_KALAKAVYA
    }

    this.defaultSender =
      process.env.SES_FROM_DEFAULT ||
      process.env.SES_FROM_CHAMKILEY ||
      "noreply@example.com"
  }

  /**
   * Resolve the sender email based on sales channel name.
   * Falls back to default if no match found.
   */
  private getSender(salesChannelName?: string): string {
    if (!salesChannelName) return this.defaultSender

    const key = salesChannelName.toLowerCase().replace(/\s+/g, "")
    for (const [pattern, sender] of Object.entries(this.senders)) {
      if (key.includes(pattern)) return sender
    }

    return this.defaultSender
  }

  /**
   * Send an email via SES.
   */
  async sendEmail(payload: EmailPayload): Promise<boolean> {
    const { to, subject, html, salesChannelName } = payload
    const from = this.getSender(salesChannelName)

    try {
      const command = new SendEmailCommand({
        Source: from,
        Destination: { ToAddresses: [to] },
        Message: {
          Subject: { Data: subject, Charset: "UTF-8" },
          Body: {
            Html: { Data: html, Charset: "UTF-8" },
          },
        },
      })

      const result = await this.client.send(command)
      this.logger.info(
        `[ses-notification] Email sent to ${to} (${subject}) — MessageId: ${result.MessageId}`
      )
      return true
    } catch (err: any) {
      this.logger.error(
        `[ses-notification] Failed to send email to ${to}: ${err?.message ?? String(err)}`
      )
      return false
    }
  }
}
