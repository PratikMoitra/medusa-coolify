/**
 * Email template engine.
 *
 * All templates are inline HTML with embedded CSS (no external stylesheets)
 * for maximum email client compatibility. Each template function receives
 * typed data and returns { subject, html }.
 *
 * Brand-specific logos and colors are sourced from:
 *   - Chamkileystore: test.chamkileystore.in  (dark navy + pink + gold)
 *   - Kalakavya:      kalakavya.in             (cream + bronze + brown)
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

// ─── Brand configuration ────────────────────────────────────────────

interface BrandConfig {
  primary: string
  accent: string
  headerBg: string
  headerText: string
  footerBg: string
  footerText: string
  buttonBg: string
  buttonText: string
  logo: string
}

const BRANDS: Record<string, BrandConfig> = {
  chamkiley: {
    primary: "#D64B75",
    accent: "#FFD700",
    headerBg: "#1E1E3C",
    headerText: "#FFFFFF",
    footerBg: "#1E1E3C",
    footerText: "#aaaaaa",
    buttonBg: "#D64B75",
    buttonText: "#FFFFFF",
    logo: "https://test.chamkileystore.in/logo.png",
  },
  kalakavya: {
    primary: "#8B6914",
    accent: "#C19A4E",
    headerBg: "#FBF5EB",
    headerText: "#4A3520",
    footerBg: "#F5EDE0",
    footerText: "#8B7355",
    buttonBg: "#8B6914",
    buttonText: "#FFFFFF",
    logo: "https://kalakavya.com/lovable-uploads/a8f41497-2bd5-4246-88da-8b6927610a34.png",
  },
  default: {
    primary: "#333333",
    accent: "#007bff",
    headerBg: "#333333",
    headerText: "#FFFFFF",
    footerBg: "#f8f9fa",
    footerText: "#999999",
    buttonBg: "#333333",
    buttonText: "#FFFFFF",
    logo: "",
  },
}

function getBrand(storeName: string): BrandConfig {
  const key = storeName.toLowerCase()
  if (key.includes("chamkiley")) return BRANDS.chamkiley
  if (key.includes("kalakavya")) return BRANDS.kalakavya
  return BRANDS.default
}

function formatCurrency(amount: number, currency: string): string {
  const symbol = currency.toLowerCase() === "inr" ? "₹" : currency.toUpperCase() + " "
  return `${symbol}${amount.toLocaleString("en-IN", { minimumFractionDigits: 2 })}`
}

function baseLayout(storeName: string, content: string): string {
  const brand = getBrand(storeName)
  const logoHtml = brand.logo
    ? `<img src="${brand.logo}" alt="${storeName}" style="max-height:80px;max-width:260px;display:inline-block;" />`
    : `<span style="color:${brand.headerText};font-size:24px;font-weight:700;letter-spacing:0.5px;">${storeName}</span>`

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${storeName}</title>
</head>
<body style="margin:0;padding:0;background-color:#f4f4f7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#f4f4f7;padding:32px 16px;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" style="background-color:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08);">
          <!-- Header with brand logo -->
          <tr>
            <td style="background:${brand.headerBg};padding:24px 40px;text-align:center;">
              ${logoHtml}
            </td>
          </tr>
          <!-- Content -->
          <tr>
            <td style="padding:36px 40px;">
              ${content}
            </td>
          </tr>
          <!-- Footer -->
          <tr>
            <td style="padding:20px 40px;background-color:${brand.footerBg};border-top:1px solid #eee;text-align:center;">
              <p style="margin:0 0 4px;color:${brand.footerText};font-size:12px;">
                © ${new Date().getFullYear()} ${storeName}. All rights reserved.
              </p>
              <p style="margin:0;color:${brand.footerText};font-size:11px;opacity:0.7;">
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
      <td style="padding:14px 0;border-bottom:1px solid #f0f0f0;">
        <strong style="color:#333;font-size:14px;">${item.title}</strong><br>
        <span style="color:#888;font-size:12px;">Qty: ${item.quantity}</span>
      </td>
      <td style="padding:14px 0;border-bottom:1px solid #f0f0f0;text-align:right;color:#333;font-weight:600;font-size:14px;">
        ${formatCurrency(item.unit_price * item.quantity, data.currency_code)}
      </td>
    </tr>`
    )
    .join("")

  const content = `
    <div style="text-align:center;margin-bottom:28px;">
      <div style="width:60px;height:60px;border-radius:50%;background:${brand.primary}18;display:inline-flex;align-items:center;justify-content:center;margin-bottom:14px;">
        <span style="font-size:28px;color:${brand.primary};">✓</span>
      </div>
      <h2 style="margin:0 0 6px;color:#333;font-size:22px;font-weight:700;">Order Confirmed!</h2>
      <p style="margin:0;color:#777;font-size:14px;">Hi ${name}, thank you for your order.</p>
    </div>

    <div style="background:#f8f9fa;border-radius:8px;padding:14px 20px;margin-bottom:20px;">
      <table width="100%" cellpadding="0" cellspacing="0">
        <tr>
          <td style="color:#777;font-size:13px;">Order Number</td>
          <td style="text-align:right;font-weight:700;color:${brand.primary};font-size:16px;">#${data.display_id}</td>
        </tr>
      </table>
    </div>

    <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:20px;">
      <tr>
        <td style="padding:8px 0;border-bottom:2px solid #eee;color:#777;font-size:11px;text-transform:uppercase;letter-spacing:1px;">Item</td>
        <td style="padding:8px 0;border-bottom:2px solid #eee;text-align:right;color:#777;font-size:11px;text-transform:uppercase;letter-spacing:1px;">Amount</td>
      </tr>
      ${itemRows}
      <tr>
        <td style="padding:16px 0;font-weight:700;font-size:15px;color:#333;">Total</td>
        <td style="padding:16px 0;text-align:right;font-weight:700;font-size:18px;color:${brand.primary};">${formatCurrency(data.total, data.currency_code)}</td>
      </tr>
    </table>

    ${
      data.shipping_address
        ? `<div style="background:#f8f9fa;border-radius:8px;padding:16px 20px;margin-bottom:20px;">
      <p style="margin:0 0 8px;color:#777;font-size:11px;text-transform:uppercase;letter-spacing:1px;">Shipping To</p>
      <p style="margin:0;color:#333;line-height:1.6;font-size:14px;">
        ${data.shipping_address.first_name || ""} ${data.shipping_address.last_name || ""}<br>
        ${data.shipping_address.address_1 || ""}<br>
        ${data.shipping_address.city || ""}, ${data.shipping_address.province || ""} ${data.shipping_address.postal_code || ""}<br>
        ${(data.shipping_address.country_code || "").toUpperCase()}
      </p>
    </div>`
        : ""
    }

    ${
      data.storeUrl
        ? `<div style="text-align:center;margin-top:24px;">
      <a href="${data.storeUrl}" style="display:inline-block;padding:12px 32px;background:${brand.buttonBg};color:${brand.buttonText};text-decoration:none;border-radius:8px;font-weight:600;font-size:14px;">
        Track Your Order
      </a>
    </div>`
        : ""
    }

    <p style="margin:24px 0 0;text-align:center;color:#999;font-size:13px;">
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
    <div style="text-align:center;margin-bottom:28px;">
      <div style="width:60px;height:60px;border-radius:50%;background:${brand.primary}18;display:inline-flex;align-items:center;justify-content:center;margin-bottom:14px;">
        <span style="font-size:28px;">🎉</span>
      </div>
      <h2 style="margin:0 0 6px;color:#333;font-size:22px;font-weight:700;">Welcome, ${name}!</h2>
      <p style="margin:0;color:#777;font-size:14px;">Your account has been created at ${data.storeName}.</p>
    </div>

    <div style="background:#f8f9fa;border-radius:8px;padding:20px;margin-bottom:24px;text-align:center;">
      <p style="margin:0 0 4px;color:#555;font-size:14px;">You can now:</p>
      <ul style="list-style:none;padding:0;margin:12px 0 0;">
        <li style="padding:6px 0;color:#333;font-size:14px;">✨ Track your orders in real-time</li>
        <li style="padding:6px 0;color:#333;font-size:14px;">💝 Save items to your wishlist</li>
        <li style="padding:6px 0;color:#333;font-size:14px;">🎁 Get exclusive member offers</li>
      </ul>
    </div>

    ${
      data.storeUrl
        ? `<div style="text-align:center;">
      <a href="${data.storeUrl}" style="display:inline-block;padding:12px 36px;background:${brand.buttonBg};color:${brand.buttonText};text-decoration:none;border-radius:8px;font-weight:600;font-size:14px;">
        Start Shopping
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
    <div style="text-align:center;margin-bottom:28px;">
      <div style="width:60px;height:60px;border-radius:50%;background:${brand.primary}18;display:inline-flex;align-items:center;justify-content:center;margin-bottom:14px;">
        <span style="font-size:28px;">🔒</span>
      </div>
      <h2 style="margin:0 0 6px;color:#333;font-size:22px;font-weight:700;">Reset Your Password</h2>
      <p style="margin:0;color:#777;font-size:14px;">Hi ${name}, we received a password reset request.</p>
    </div>

    <p style="color:#555;line-height:1.8;font-size:14px;text-align:center;">
      Click the button below to reset your password. This link expires in 1 hour.
    </p>

    <div style="text-align:center;margin:28px 0;">
      <a href="${data.reset_link}" style="display:inline-block;background:${brand.buttonBg};color:${brand.buttonText};padding:12px 36px;border-radius:8px;text-decoration:none;font-weight:600;font-size:14px;">
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
    <div style="text-align:center;margin-bottom:28px;">
      <div style="width:60px;height:60px;border-radius:50%;background:${brand.primary}18;display:inline-flex;align-items:center;justify-content:center;margin-bottom:14px;">
        <span style="font-size:28px;">💰</span>
      </div>
      <h2 style="margin:0 0 6px;color:#333;font-size:22px;font-weight:700;">Refund Processed</h2>
      <p style="margin:0;color:#777;font-size:14px;">Your refund for Order #${data.display_id} has been processed.</p>
    </div>

    <div style="background:#f8f9fa;border-radius:8px;padding:16px 20px;margin-bottom:20px;">
      <table width="100%" cellpadding="0" cellspacing="0">
        <tr>
          <td style="color:#777;font-size:13px;padding:6px 0;">Refund Amount</td>
          <td style="text-align:right;font-weight:700;color:${brand.primary};font-size:18px;">${formatCurrency(data.amount, data.currency_code)}</td>
        </tr>
        ${data.reason ? `<tr><td style="color:#777;font-size:13px;padding:6px 0;">Reason</td><td style="text-align:right;color:#333;font-size:14px;">${data.reason}</td></tr>` : ""}
      </table>
    </div>

    <p style="margin:0;color:#555;font-size:14px;line-height:1.6;">
      The refund will be credited to your original payment method within <strong>5-7 business days</strong>.
      If you have any questions, please contact our support team.
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
    <div style="text-align:center;margin-bottom:28px;">
      <div style="width:60px;height:60px;border-radius:50%;background:${brand.primary}18;display:inline-flex;align-items:center;justify-content:center;margin-bottom:14px;">
        <span style="font-size:28px;">🚚</span>
      </div>
      <h2 style="margin:0 0 6px;color:#333;font-size:22px;font-weight:700;">Your Order Has Shipped!</h2>
      <p style="margin:0;color:#777;font-size:14px;">Order #${data.display_id} is on its way to you.</p>
    </div>

    <div style="background:#f8f9fa;border-radius:8px;padding:16px 20px;margin-bottom:20px;">
      <table width="100%" cellpadding="0" cellspacing="0">
        ${data.carrier ? `<tr><td style="color:#777;font-size:13px;padding:6px 0;">Carrier</td><td style="text-align:right;font-weight:600;color:#333;font-size:14px;">${data.carrier}</td></tr>` : ""}
        ${data.tracking_number ? `<tr><td style="color:#777;font-size:13px;padding:6px 0;">Tracking Number</td><td style="text-align:right;font-weight:600;color:${brand.primary};font-size:14px;">${data.tracking_number}</td></tr>` : ""}
      </table>
    </div>

    ${
      data.tracking_url
        ? `<div style="text-align:center;margin-top:24px;">
      <a href="${data.tracking_url}" style="display:inline-block;padding:12px 32px;background:${brand.buttonBg};color:${brand.buttonText};text-decoration:none;border-radius:8px;font-weight:600;font-size:14px;">
        Track Package
      </a>
    </div>`
        : ""
    }

    <p style="margin:24px 0 0;text-align:center;color:#999;font-size:13px;">
      Estimated delivery: 3-5 business days 🏠
    </p>`

  return {
    subject: `Your order #${data.display_id} has shipped! 📦 — ${data.storeName}`,
    html: baseLayout(data.storeName, content),
  }
}
