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
  sku?: string
  weight?: string
  variant_title?: string
  variant_options?: Record<string, string>
}

interface OrderData {
  order_id: string
  display_id: number | string
  items: OrderItem[]
  total: number
  subtotal?: number
  shipping_total?: number
  discount_total?: number
  tax_total?: number
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
  companyName: string
  companyAddress: string
  gstn: string
  contactPhone: string
  contactEmail: string
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
    companyName: "Kalakavya Ecommerce LLP",
    companyAddress: "C812 Brigade Northridge Apts,\nKogilu Road, Near Belahalli Circle,\nYelahanka, Bengaluru 560064\nKarnataka, India",
    gstn: "29ABCFK6093Q1ZG",
    contactPhone: "+91-9874819217",
    contactEmail: "Hello@chamkileystore.in",
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
    companyName: "Kalakavya Ecommerce LLP",
    companyAddress: "C812 Brigade Northridge Apts,\nKogilu Road, Near Belahalli Circle,\nYelahanka, Bengaluru 560064\nKarnataka, India",
    gstn: "29ABCFK6093Q1ZG",
    contactPhone: "+91-9874819217",
    contactEmail: "Hello@kalakavya.in",
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
    companyName: "Kalakavya Ecommerce LLP",
    companyAddress: "Bengaluru, Karnataka, India",
    gstn: "29ABCFK6093Q1ZG",
    contactPhone: "+91-9874819217",
    contactEmail: "admin@kalakavya.in",
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
  const formatted = amount % 1 === 0
    ? amount.toLocaleString("en-IN")
    : amount.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  return `${symbol}${formatted}`
}

function generateInvoiceNumber(displayId: number | string, storeName: string, createdAt?: string): string {
  const date = createdAt ? new Date(createdAt) : new Date()
  const month = String(date.getMonth() + 1).padStart(2, "0")
  const year = date.getFullYear()
  const prefix = storeName.toLowerCase().includes("kalakavya") ? "KK-KV" : "KK-CS"
  return `${prefix}-${month}-${String(displayId).padStart(3, "0")}${year}`
}

function formatDate(dateStr?: string): string {
  if (!dateStr) return new Date().toLocaleDateString("en-IN", { month: "long", day: "numeric", year: "numeric" })
  return new Date(dateStr).toLocaleDateString("en-IN", { month: "long", day: "numeric", year: "numeric" })
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
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#f4f4f7;padding:32px 16px;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" style="background-color:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08);">
          <!-- Accent bar -->
          <tr>
            <td style="background:${brand.headerBg};height:6px;font-size:0;line-height:0;">&nbsp;</td>
          </tr>
          <!-- Content -->
          <tr>
            <td style="padding:0;">
              ${content}
            </td>
          </tr>
          <!-- Footer -->
          <tr>
            <td style="padding:20px 40px;background-color:${brand.footerBg};border-top:1px solid #eee;text-align:center;">
              <p style="margin:0 0 4px;color:${brand.footerText};font-size:12px;">
                \u00A9 ${new Date().getFullYear()} ${storeName}. All rights reserved.
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
  const invoiceNumber = generateInvoiceNumber(data.display_id, data.storeName, data.created_at)
  const invoiceDate = formatDate(data.created_at)
  const orderDate = formatDate(data.created_at)

  const subtotal = data.subtotal ?? data.items.reduce((sum, item) => sum + (item.unit_price * item.quantity), 0)
  const shippingTotal = data.shipping_total ?? 0
  const discountTotal = data.discount_total ?? 0
  const orderTotal = data.total
  // GST is inclusive — back-calculate from the total: total × 5/105
  const taxTotal = Math.round(orderTotal * 5 / 105)

  const companyAddressHtml = brand.companyAddress.split("\n").join("<br>")

  const itemRows = (data.items || [])
    .map((item) => {
      const details: string[] = []
      if (item.sku) details.push(`<strong>SKU:</strong> ${item.sku}`)
      if (item.weight) details.push(`<strong>Weight:</strong> ${item.weight}`)
      if (item.variant_options) {
        for (const [key, value] of Object.entries(item.variant_options)) {
          details.push(`<strong>${key}:</strong> ${value}`)
        }
      } else if (item.variant_title) {
        details.push(`<strong>Variant:</strong> ${item.variant_title}`)
      }
      const detailsHtml = details.length > 0
        ? `<br><span style="color:#777;font-size:11px;line-height:1.6;">${details.join("<br>")}</span>`
        : ""

      return `
    <tr>
      <td style="padding:12px 16px;border-bottom:1px solid #eee;vertical-align:top;">
        <strong style="color:#333;font-size:13px;">${item.title}${item.variant_title ? ` - ${item.variant_title}` : ""}</strong>
        ${detailsHtml}
      </td>
      <td style="padding:12px 8px;border-bottom:1px solid #eee;text-align:center;color:#333;font-size:13px;vertical-align:top;">
        ${item.quantity}
      </td>
      <td style="padding:12px 16px;border-bottom:1px solid #eee;text-align:right;color:#333;font-size:13px;font-weight:600;vertical-align:top;">
        ${formatCurrency(item.unit_price * item.quantity, data.currency_code)}
      </td>
    </tr>`
    })
    .join("")

  const content = `
    <!-- Logo + Company Details Header -->
    <table width="100%" cellpadding="0" cellspacing="0" style="padding:24px 32px 16px;">
      <tr>
        <td style="vertical-align:top;width:45%;">
          ${brand.logo
            ? `<img src="${brand.logo}" alt="${data.storeName}" style="max-height:80px;max-width:180px;display:block;" />`
            : `<span style="font-size:22px;font-weight:700;color:${brand.primary};">${data.storeName}</span>`
          }
        </td>
        <td style="vertical-align:top;text-align:right;font-size:12px;color:#555;line-height:1.6;">
          <strong style="font-size:13px;color:#333;">${brand.companyName}</strong><br>
          ${companyAddressHtml}<br>
          <strong>GSTN:</strong> ${brand.gstn}<br>
          <strong>Contact:</strong> ${brand.contactPhone}<br>
          ${brand.contactEmail}
        </td>
      </tr>
    </table>

    <!-- INVOICE Title -->
    <div style="padding:0 32px 16px;">
      <h1 style="margin:0 0 16px;font-size:26px;font-weight:800;color:#1a1a1a;letter-spacing:-0.5px;">INVOICE</h1>

      <!-- Customer + Invoice Details -->
      <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:20px;">
        <tr>
          <td style="vertical-align:top;width:50%;font-size:13px;color:#333;line-height:1.7;">
            ${data.shipping_address ? `
              <strong>${data.shipping_address.first_name || ""} ${data.shipping_address.last_name || ""}</strong><br>
              ${data.shipping_address.city || ""}${data.shipping_address.province ? `<br>${data.shipping_address.province}` : ""}
            ` : `<strong>${name}</strong>`}
          </td>
          <td style="vertical-align:top;text-align:right;font-size:12px;color:#555;line-height:1.8;">
            <table cellpadding="0" cellspacing="0" style="margin-left:auto;">
              <tr>
                <td style="padding:2px 12px 2px 0;color:#777;font-size:12px;">Invoice Number:</td>
                <td style="padding:2px 0;font-weight:600;color:#333;font-size:12px;">${invoiceNumber}</td>
              </tr>
              <tr>
                <td style="padding:2px 12px 2px 0;color:#777;font-size:12px;">Invoice Date:</td>
                <td style="padding:2px 0;font-weight:600;color:#333;font-size:12px;">${invoiceDate}</td>
              </tr>
              <tr>
                <td style="padding:2px 12px 2px 0;color:#777;font-size:12px;">Order Number:</td>
                <td style="padding:2px 0;font-weight:600;color:#333;font-size:12px;">${data.display_id}</td>
              </tr>
              <tr>
                <td style="padding:2px 12px 2px 0;color:#777;font-size:12px;">Order Date:</td>
                <td style="padding:2px 0;font-weight:600;color:#333;font-size:12px;">${orderDate}</td>
              </tr>
            </table>
          </td>
        </tr>
      </table>

      <!-- Items Table -->
      <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin-bottom:0;">
        <tr style="background-color:${brand.primary};">
          <td style="padding:10px 16px;color:${brand.buttonText};font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;border-radius:6px 0 0 0;">Product</td>
          <td style="padding:10px 8px;color:${brand.buttonText};font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;text-align:center;">Quantity</td>
          <td style="padding:10px 16px;color:${brand.buttonText};font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;text-align:right;border-radius:0 6px 0 0;">Price</td>
        </tr>
        ${itemRows}
      </table>

      <!-- Totals -->
      <table width="100%" cellpadding="0" cellspacing="0" style="margin-top:0;">
        <tr>
          <td style="width:55%;"></td>
          <td style="padding:12px 16px;">
            <table width="100%" cellpadding="0" cellspacing="0">
              <tr>
                <td style="padding:6px 0;color:#555;font-size:13px;font-weight:600;">Subtotal</td>
                <td style="padding:6px 0;text-align:right;color:#333;font-size:13px;font-weight:600;">${formatCurrency(subtotal, data.currency_code)}</td>
              </tr>
              ${discountTotal > 0 ? `
              <tr>
                <td style="padding:6px 0;color:#22a55d;font-size:13px;font-weight:600;">Discount</td>
                <td style="padding:6px 0;text-align:right;color:#22a55d;font-size:13px;font-weight:600;">-${formatCurrency(discountTotal, data.currency_code)}</td>
              </tr>` : ""}
              ${shippingTotal > 0 ? `
              <tr>
                <td style="padding:6px 0;color:#555;font-size:13px;">Shipping</td>
                <td style="padding:6px 0;text-align:right;color:#333;font-size:13px;">${formatCurrency(shippingTotal, data.currency_code)}</td>
              </tr>` : `
              <tr>
                <td style="padding:6px 0;color:#555;font-size:13px;">Shipping</td>
                <td style="padding:6px 0;text-align:right;color:#22a55d;font-size:13px;font-weight:600;">FREE</td>
              </tr>`}
              <tr>
                <td colspan="2" style="padding:0;"><div style="border-top:2px solid #eee;margin:4px 0;"></div></td>
              </tr>
              <tr>
                <td style="padding:8px 0;color:#1a1a1a;font-size:15px;font-weight:700;">Total</td>
                <td style="padding:8px 0;text-align:right;color:#1a1a1a;font-size:15px;font-weight:700;">
                  ${formatCurrency(orderTotal, data.currency_code)}
                  ${taxTotal > 0 ? (() => {
                    const province = (data.shipping_address?.province || "").toLowerCase()
                    const isKarnataka = province.includes("karnataka") || province === "ka"
                    const taxLabel = isKarnataka
                      ? `CGST 2.5% + SGST 2.5%`
                      : `IGST 5%`
                    const halfTax = formatCurrency(Math.round(taxTotal / 2), data.currency_code)
                    const taxBreakdown = isKarnataka
                      ? `CGST: ${halfTax} + SGST: ${halfTax}`
                      : `IGST: ${formatCurrency(taxTotal, data.currency_code)}`
                    return `<br><span style="font-size:11px;font-weight:400;color:#777;">(includes ${formatCurrency(taxTotal, data.currency_code)}<br>${taxLabel})</span>`
                  })() : ""}
                </td>
              </tr>
            </table>
          </td>
        </tr>
      </table>
    </div>

    <!-- QR Code Section -->
    ${data.storeUrl ? `
    <div style="text-align:center;padding:20px 32px 8px;border-top:1px solid #f0f0f0;">
      <p style="margin:0 0 6px;color:#333;font-size:14px;font-weight:600;">Your Live Order Tracker</p>
      <p style="margin:0 0 16px;color:#777;font-size:12px;line-height:1.5;">
        Scan this QR code anytime to check your order status.<br>
        Real-time updates on payment, packing, shipping, and delivery.
      </p>
      <img src="https://api.qrserver.com/v1/create-qr-code/?size=200x200&ecc=H&data=${encodeURIComponent(data.storeUrl + "/order/track/" + data.order_id + "?ref=qr")}" alt="Order QR Code" style="width:130px;height:130px;display:inline-block;" />
      <br>
      <img src="${brand.logo}" alt="${data.storeName}" style="max-height:24px;max-width:90px;display:inline-block;margin-top:8px;" />
      <p style="margin:6px 0 0;color:#aaa;font-size:11px;">Order #${data.display_id}</p>
    </div>` : ""}

    <!-- Track Order Button -->
    ${data.storeUrl ? `
    <div style="text-align:center;padding:12px 32px 20px;">
      <a href="${data.storeUrl}/order/track/${data.order_id}?ref=email" style="display:inline-block;padding:12px 32px;background:${brand.buttonBg};color:${brand.buttonText};text-decoration:none;border-radius:8px;font-weight:600;font-size:14px;">
        Track Your Order
      </a>
    </div>` : ""}

    <!-- Legal Footer -->
    <div style="padding:16px 32px;background-color:#fafafa;border-top:1px solid #f0f0f0;">
      <p style="margin:0 0 4px;color:#999;font-size:11px;text-align:center;">
        All purchases are subject to our Terms and Conditions available on our website.
      </p>
      <p style="margin:0;color:#999;font-size:11px;text-align:center;">
        This is a computer-generated invoice. GST details are mentioned, as per Government regulations.
      </p>
    </div>

    <p style="margin:12px 32px 20px;text-align:center;color:#999;font-size:13px;">
      We'll notify you when your order ships.
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
    <div style="padding:36px 40px;">
      <div style="text-align:center;margin-bottom:28px;">
        <div style="width:40px;height:4px;background:${brand.primary};border-radius:2px;margin:0 auto 20px;"></div>
        ${brand.logo ? `<img src="${brand.logo}" alt="${data.storeName}" style="max-height:100px;max-width:300px;display:inline-block;margin-bottom:16px;" />` : ""}
        <h2 style="margin:0 0 6px;color:#333;font-size:22px;font-weight:700;">Welcome, ${name}!</h2>
        <p style="margin:0;color:#777;font-size:14px;">Your account has been created at ${data.storeName}.</p>
      </div>

      <div style="background:#f8f9fa;border-radius:8px;padding:20px;margin-bottom:24px;">
        <p style="margin:0 0 12px;color:#555;font-size:14px;font-weight:600;">You can now:</p>
        <table width="100%" cellpadding="0" cellspacing="0">
          <tr><td style="padding:8px 0;color:#333;font-size:14px;border-bottom:1px solid #eee;">Track your orders in real-time</td></tr>
          <tr><td style="padding:8px 0;color:#333;font-size:14px;border-bottom:1px solid #eee;">Save items to your wishlist</td></tr>
          <tr><td style="padding:8px 0;color:#333;font-size:14px;">Get exclusive member offers</td></tr>
        </table>
      </div>

      ${
        data.storeUrl
          ? `<div style="text-align:center;">
        <a href="${data.storeUrl}" style="display:inline-block;padding:12px 36px;background:${brand.buttonBg};color:${brand.buttonText};text-decoration:none;border-radius:8px;font-weight:600;font-size:14px;">
          Start Shopping
        </a>
      </div>`
          : ""
      }
    </div>`

  return {
    subject: `Welcome to ${data.storeName}!`,
    html: baseLayout(data.storeName, content),
  }
}

export function passwordResetEmail(data: PasswordResetData): { subject: string; html: string } {
  const brand = getBrand(data.storeName)
  const name = data.first_name || "there"

  const content = `
    <div style="padding:36px 40px;">
      <div style="text-align:center;margin-bottom:28px;">
        <div style="width:40px;height:4px;background:${brand.primary};border-radius:2px;margin:0 auto 20px;"></div>
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
      </p>
    </div>`

  return {
    subject: `Reset your password — ${data.storeName}`,
    html: baseLayout(data.storeName, content),
  }
}

export function refundEmail(data: RefundData): { subject: string; html: string } {
  const brand = getBrand(data.storeName)
  const name = data.customer_name || "there"

  const content = `
    <div style="padding:36px 40px;">
      <div style="text-align:center;margin-bottom:28px;">
        <div style="width:40px;height:4px;background:${brand.primary};border-radius:2px;margin:0 auto 20px;"></div>
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
      </p>
    </div>`

  return {
    subject: `Refund processed for Order #${data.display_id} — ${data.storeName}`,
    html: baseLayout(data.storeName, content),
  }
}

export function shippingNotificationEmail(data: ShippingData): { subject: string; html: string } {
  const brand = getBrand(data.storeName)
  const name = data.customer_name || "there"

  const content = `
    <div style="padding:36px 40px;">
      <div style="text-align:center;margin-bottom:28px;">
        <div style="width:40px;height:4px;background:${brand.primary};border-radius:2px;margin:0 auto 20px;"></div>
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
        Estimated delivery: 3-5 business days
      </p>
    </div>`

  return {
    subject: `Your order #${data.display_id} has shipped — ${data.storeName}`,
    html: baseLayout(data.storeName, content),
  }
}
