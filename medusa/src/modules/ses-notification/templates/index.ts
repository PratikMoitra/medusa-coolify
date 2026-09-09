/**
 * Email template engine.
 *
 * All templates are inline HTML with embedded CSS (no external stylesheets)
 * for maximum email client compatibility. Each template function receives
 * typed data and returns { subject, html }.
 */

interface OrderItem {
  title: string
  quantity: number
  unit_price: number
  thumbnail?: string
}

interface OrderData {
  display_id: number | string
  items: OrderItem[]
  total: number
  currency_code: string
  customer_email: string
  customer_name?: string
  shipping_address?: {
    first_name?: string
    last_name?: string
    address_1?: string
    city?: string
    province?: string
    postal_code?: string
    country_code?: string
  }
  created_at?: string
  storeName: string
  storeUrl?: string
}

interface CustomerData {
  email: string
  first_name?: string
  last_name?: string
  storeName: string
  storeUrl?: string
}

interface RefundData {
  display_id: number | string
  amount: number
  currency_code: string
  customer_email: string
  customer_name?: string
  reason?: string
  storeName: string
}

interface ShippingData {
  display_id: number | string
  tracking_number?: string
  tracking_url?: string
  carrier?: string
  customer_email: string
  customer_name?: string
  storeName: string
  storeUrl?: string
}

interface PasswordResetData {
  email: string
  first_name?: string
  reset_link: string
  storeName: string
}

// ─── Shared styles ──────────────────────────────────────────────────

const BRAND_COLORS: Record<string, { primary: string; accent: string; logo?: string }> = {
  chamkiley: {
    primary: "#D64B75",
    accent: "#FFD700",
  },
  kalakavya: {
    primary: "#6B4C8A",
    accent: "#E8B86D",
  },
  default: {
    primary: "#333333",
    accent: "#007bff",
  },
}

function getBrand(storeName: string) {
  const key = storeName.toLowerCase()
  if (key.includes("chamkiley")) return BRAND_COLORS.chamkiley
  if (key.includes("kalakavya")) return BRAND_COLORS.kalakavya
  return BRAND_COLORS.default
}

function formatCurrency(amount: number, currency: string): string {
  const symbol = currency.toLowerCase() === "inr" ? "₹" : currency.toUpperCase() + " "
  return `${symbol}${(amount / 100).toLocaleString("en-IN", { minimumFractionDigits: 2 })}`
}

function baseLayout(storeName: string, content: string): string {
  const brand = getBrand(storeName)
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${storeName}</title>
</head>
<body style="margin:0;padding:0;background-color:#f4f4f7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#f4f4f7;padding:40px 20px;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" style="background-color:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08);">
          <!-- Header -->
          <tr>
            <td style="background:linear-gradient(135deg,${brand.primary},${brand.primary}dd);padding:32px 40px;text-align:center;">
              <h1 style="margin:0;color:#ffffff;font-size:24px;font-weight:700;letter-spacing:0.5px;">${storeName}</h1>
            </td>
          </tr>
          <!-- Content -->
          <tr>
            <td style="padding:40px;">
              ${content}
            </td>
          </tr>
          <!-- Footer -->
          <tr>
            <td style="padding:24px 40px;background-color:#f8f9fa;border-top:1px solid #eee;text-align:center;">
              <p style="margin:0;color:#999;font-size:12px;">
                © ${new Date().getFullYear()} ${storeName}. All rights reserved.<br>
                This is a transactional email. Please do not reply directly.
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`
}

// ─── Templates ──────────────────────────────────────────────────────

export function orderConfirmationEmail(data: OrderData): { subject: string; html: string } {
  const brand = getBrand(data.storeName)
  const name = data.customer_name || data.shipping_address?.first_name || "there"

  const itemRows = (data.items || [])
    .map(
      (item) => `
    <tr>
      <td style="padding:12px 0;border-bottom:1px solid #f0f0f0;">
        <strong style="color:#333;">${item.title}</strong><br>
        <span style="color:#777;font-size:13px;">Qty: ${item.quantity}</span>
      </td>
      <td style="padding:12px 0;border-bottom:1px solid #f0f0f0;text-align:right;color:#333;font-weight:600;">
        ${formatCurrency(item.unit_price * item.quantity, data.currency_code)}
      </td>
    </tr>`
    )
    .join("")

  const content = `
    <div style="text-align:center;margin-bottom:32px;">
      <div style="width:64px;height:64px;border-radius:50%;background:${brand.primary}15;display:inline-flex;align-items:center;justify-content:center;margin-bottom:16px;">
        <span style="font-size:32px;">✓</span>
      </div>
      <h2 style="margin:0 0 8px;color:#333;font-size:22px;">Order Confirmed!</h2>
      <p style="margin:0;color:#777;">Hi ${name}, thank you for your order.</p>
    </div>

    <div style="background:#f8f9fa;border-radius:8px;padding:16px 20px;margin-bottom:24px;">
      <table width="100%" cellpadding="0" cellspacing="0">
        <tr>
          <td style="color:#777;font-size:13px;">Order Number</td>
          <td style="text-align:right;font-weight:700;color:${brand.primary};font-size:16px;">#${data.display_id}</td>
        </tr>
      </table>
    </div>

    <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:24px;">
      <tr>
        <td style="padding:8px 0;border-bottom:2px solid #eee;color:#777;font-size:13px;text-transform:uppercase;letter-spacing:1px;">Item</td>
        <td style="padding:8px 0;border-bottom:2px solid #eee;text-align:right;color:#777;font-size:13px;text-transform:uppercase;letter-spacing:1px;">Amount</td>
      </tr>
      ${itemRows}
      <tr>
        <td style="padding:16px 0;font-weight:700;font-size:16px;color:#333;">Total</td>
        <td style="padding:16px 0;text-align:right;font-weight:700;font-size:18px;color:${brand.primary};">${formatCurrency(data.total, data.currency_code)}</td>
      </tr>
    </table>

    ${
      data.shipping_address
        ? `<div style="background:#f8f9fa;border-radius:8px;padding:16px 20px;">
      <p style="margin:0 0 8px;color:#777;font-size:13px;text-transform:uppercase;letter-spacing:1px;">Shipping To</p>
      <p style="margin:0;color:#333;line-height:1.6;">
        ${data.shipping_address.first_name || ""} ${data.shipping_address.last_name || ""}<br>
        ${data.shipping_address.address_1 || ""}<br>
        ${data.shipping_address.city || ""}, ${data.shipping_address.province || ""} ${data.shipping_address.postal_code || ""}<br>
        ${(data.shipping_address.country_code || "").toUpperCase()}
      </p>
    </div>`
        : ""
    }

    <p style="margin:32px 0 0;text-align:center;color:#777;font-size:14px;">
      We'll notify you when your order ships. 📦
    </p>`

  return {
    subject: `Order #${data.display_id} confirmed — ${data.storeName}`,
    html: baseLayout(data.storeName, content),
  }
}

export function welcomeEmail(data: CustomerData): { subject: string; html: string } {
  const brand = getBrand(data.storeName)
  const name = data.first_name || "there"

  const content = `
    <div style="text-align:center;margin-bottom:32px;">
      <div style="width:64px;height:64px;border-radius:50%;background:${brand.primary}15;display:inline-flex;align-items:center;justify-content:center;margin-bottom:16px;">
        <span style="font-size:32px;">🎉</span>
      </div>
      <h2 style="margin:0 0 8px;color:#333;font-size:22px;">Welcome, ${name}!</h2>
      <p style="margin:0;color:#777;">Your account has been created at ${data.storeName}.</p>
    </div>

    <p style="color:#555;line-height:1.8;font-size:15px;">
      We're thrilled to have you join us. Here's what you can look forward to:
    </p>

    <ul style="color:#555;line-height:2;font-size:15px;padding-left:20px;">
      <li>Exclusive access to new collections</li>
      <li>Easy order tracking and history</li>
      <li>Saved addresses for faster checkout</li>
    </ul>

    ${
      data.storeUrl
        ? `<div style="text-align:center;margin-top:32px;">
      <a href="${data.storeUrl}" style="display:inline-block;background:${brand.primary};color:#fff;padding:14px 40px;border-radius:8px;text-decoration:none;font-weight:600;font-size:15px;">
        Start Shopping →
      </a>
    </div>`
        : ""
    }`

  return {
    subject: `Welcome to ${data.storeName}! 🎉`,
    html: baseLayout(data.storeName, content),
  }
}

export function passwordResetEmail(data: PasswordResetData): { subject: string; html: string } {
  const brand = getBrand(data.storeName)
  const name = data.first_name || "there"

  const content = `
    <div style="text-align:center;margin-bottom:32px;">
      <h2 style="margin:0 0 8px;color:#333;font-size:22px;">Reset Your Password</h2>
      <p style="margin:0;color:#777;">Hi ${name}, we received a password reset request.</p>
    </div>

    <p style="color:#555;line-height:1.8;font-size:15px;">
      Click the button below to reset your password. This link expires in 1 hour.
    </p>

    <div style="text-align:center;margin:32px 0;">
      <a href="${data.reset_link}" style="display:inline-block;background:${brand.primary};color:#fff;padding:14px 40px;border-radius:8px;text-decoration:none;font-weight:600;font-size:15px;">
        Reset Password
      </a>
    </div>

    <p style="color:#999;font-size:13px;text-align:center;">
      If you didn't request this, you can safely ignore this email.
    </p>`

  return {
    subject: `Reset your password — ${data.storeName}`,
    html: baseLayout(data.storeName, content),
  }
}

export function refundEmail(data: RefundData): { subject: string; html: string } {
  const brand = getBrand(data.storeName)
  const name = data.customer_name || "there"

  const content = `
    <div style="text-align:center;margin-bottom:32px;">
      <div style="width:64px;height:64px;border-radius:50%;background:#4CAF5015;display:inline-flex;align-items:center;justify-content:center;margin-bottom:16px;">
        <span style="font-size:32px;">💰</span>
      </div>
      <h2 style="margin:0 0 8px;color:#333;font-size:22px;">Refund Processed</h2>
      <p style="margin:0;color:#777;">Hi ${name}, your refund has been initiated.</p>
    </div>

    <div style="background:#f8f9fa;border-radius:8px;padding:20px;margin-bottom:24px;">
      <table width="100%" cellpadding="0" cellspacing="0">
        <tr>
          <td style="color:#777;font-size:13px;padding:4px 0;">Order</td>
          <td style="text-align:right;font-weight:600;color:#333;">#${data.display_id}</td>
        </tr>
        <tr>
          <td style="color:#777;font-size:13px;padding:4px 0;">Refund Amount</td>
          <td style="text-align:right;font-weight:700;color:#4CAF50;font-size:18px;">${formatCurrency(data.amount, data.currency_code)}</td>
        </tr>
        ${data.reason ? `<tr><td style="color:#777;font-size:13px;padding:4px 0;">Reason</td><td style="text-align:right;color:#333;">${data.reason}</td></tr>` : ""}
      </table>
    </div>

    <p style="color:#555;line-height:1.8;font-size:15px;">
      The refund will be credited to your original payment method within 5-7 business days.
    </p>`

  return {
    subject: `Refund processed for Order #${data.display_id} — ${data.storeName}`,
    html: baseLayout(data.storeName, content),
  }
}

export function shippingNotificationEmail(data: ShippingData): { subject: string; html: string } {
  const brand = getBrand(data.storeName)
  const name = data.customer_name || "there"

  const content = `
    <div style="text-align:center;margin-bottom:32px;">
      <div style="width:64px;height:64px;border-radius:50%;background:${brand.primary}15;display:inline-flex;align-items:center;justify-content:center;margin-bottom:16px;">
        <span style="font-size:32px;">📦</span>
      </div>
      <h2 style="margin:0 0 8px;color:#333;font-size:22px;">Your Order Has Shipped!</h2>
      <p style="margin:0;color:#777;">Hi ${name}, great news — order #${data.display_id} is on its way.</p>
    </div>

    <div style="background:#f8f9fa;border-radius:8px;padding:20px;margin-bottom:24px;">
      <table width="100%" cellpadding="0" cellspacing="0">
        <tr>
          <td style="color:#777;font-size:13px;padding:4px 0;">Order</td>
          <td style="text-align:right;font-weight:600;color:#333;">#${data.display_id}</td>
        </tr>
        ${data.carrier ? `<tr><td style="color:#777;font-size:13px;padding:4px 0;">Carrier</td><td style="text-align:right;color:#333;">${data.carrier}</td></tr>` : ""}
        ${data.tracking_number ? `<tr><td style="color:#777;font-size:13px;padding:4px 0;">Tracking #</td><td style="text-align:right;font-weight:600;color:${brand.primary};">${data.tracking_number}</td></tr>` : ""}
      </table>
    </div>

    ${
      data.tracking_url
        ? `<div style="text-align:center;margin:32px 0;">
      <a href="${data.tracking_url}" style="display:inline-block;background:${brand.primary};color:#fff;padding:14px 40px;border-radius:8px;text-decoration:none;font-weight:600;font-size:15px;">
        Track Your Order →
      </a>
    </div>`
        : ""
    }

    <p style="color:#777;font-size:14px;text-align:center;">
      Estimated delivery: 3-7 business days
    </p>`

  return {
    subject: `Your order #${data.display_id} has shipped! 📦 — ${data.storeName}`,
    html: baseLayout(data.storeName, content),
  }
}
