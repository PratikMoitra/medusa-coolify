/**
 * Telegram Bot API helper
 *
 * Sends messages to a Telegram chat/channel via the Bot API.
 * Used by telegram-notifier.ts for admin alerts.
 *
 * Configuration (env vars):
 *   - TELEGRAM_BOT_TOKEN: Bot token from @BotFather
 *   - TELEGRAM_CHAT_ID:   Chat/channel/group ID to send to
 *
 * Uses HTML parse_mode for reliable formatting.
 * Never throws — failures are silently logged.
 */

export async function sendTelegramMessage(
  text: string,
  logger?: { warn: (msg: string) => void }
): Promise<boolean> {
  const token = process.env.TELEGRAM_BOT_TOKEN
  const chatId = process.env.TELEGRAM_CHAT_ID

  if (!token || !chatId) {
    logger?.warn("[telegram] TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID not set, skipping")
    return false
  }

  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: "HTML",
        disable_web_page_preview: true,
      }),
      signal: AbortSignal.timeout(5000),
    })

    if (!res.ok) {
      const err = await res.json().catch(() => ({}))
      logger?.warn(`[telegram] API error: ${err?.description || res.status}`)
      return false
    }

    return true
  } catch (err: any) {
    logger?.warn(`[telegram] Send failed: ${err?.message || String(err)}`)
    return false
  }
}

/** Escape HTML special chars for Telegram HTML parse_mode */
export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
}
