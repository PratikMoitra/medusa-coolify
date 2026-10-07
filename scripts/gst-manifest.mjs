#!/usr/bin/env node
/**
 * gst-manifest.mjs — Monthly GST Invoice Manifest Report
 *
 * Generates a GST manifest for paid orders within a date range,
 * grouped by sales channel. Sends the report as a CSV attachment
 * to contact@kalakavya.in via AWS SES.
 *
 * Subject: <SalesChannel>-GST-Manifest-<StartDate> - <EndDate>@Generated at <IST time>
 *
 * ─── Usage ───────────────────────────────────────────────────────
 *
 *   # Auto mode: generates last month's report (default)
 *   node scripts/gst-manifest.mjs
 *
 *   # Custom date range
 *   node scripts/gst-manifest.mjs --start 2026-09-01 --end 2026-09-30
 *
 *   # Specific sales channel only
 *   node scripts/gst-manifest.mjs --channel "Chamkiley Store"
 *
 *   # Dry run (generate CSV but don't email)
 *   node scripts/gst-manifest.mjs --dry-run
 *
 *   # All options combined
 *   node scripts/gst-manifest.mjs --start 2026-08-01 --end 2026-08-31 --channel "Chamkiley Store" --dry-run
 *
 *   # Show help
 *   node scripts/gst-manifest.mjs --help
 *
 * ─── Environment Variables ───────────────────────────────────────
 *
 *   Required:
 *     MEDUSA_URL              — Medusa backend URL (default: https://medusajs.psmhome.no)
 *     MEDUSA_ADMIN_EMAIL      — Admin email for authentication
 *     MEDUSA_ADMIN_PASSWORD   — Admin password
 *
 *   For email delivery:
 *     AWS_SES_REGION          — SES region (default: ap-south-1)
 *     AWS_SES_ACCESS_KEY_ID   — IAM access key
 *     AWS_SES_SECRET_ACCESS_KEY — IAM secret key
 *     GST_REPORT_FROM_EMAIL   — Sender email (default: noreply@chamkileystore.in)
 *     GST_REPORT_TO_EMAIL     — Recipient email (default: contact@kalakavya.in)
 *
 *   Tax config:
 *     GST_RATE                — GST percentage (default: 5)
 *     SELLER_STATE            — Seller's state (default: Karnataka)
 *
 * ─── Cron Setup (monthly) ────────────────────────────────────────
 *
 *   # Run on 2nd of every month at 6:00 AM IST (00:30 UTC)
 *   30 0 2 * * cd /path/to/medusa-coolify && node scripts/gst-manifest.mjs >> /var/log/gst-manifest.log 2>&1
 *
 * ─── n8n Setup ───────────────────────────────────────────────────
 *
 *   Trigger: Cron — 2nd of every month, 06:00 IST
 *   Action: Execute Command node → "node scripts/gst-manifest.mjs"
 *   Or: HTTP Request → POST to a custom API route that runs this script
 */

// ── CLI Argument Parsing ──────────────────────────────────────────

const args = process.argv.slice(2)

function getArg(name) {
  const idx = args.indexOf(`--${name}`)
  if (idx === -1 || idx + 1 >= args.length) return null
  return args[idx + 1]
}

const hasFlag = (name) => args.includes(`--${name}`)

if (hasFlag("help")) {
  console.log(`
GST Manifest Report Generator
==============================

Usage:
  node scripts/gst-manifest.mjs [options]

Options:
  --start YYYY-MM-DD    Start date (default: 1st of last month)
  --end   YYYY-MM-DD    End date (default: last day of last month)
  --channel "Name"      Filter by sales channel name (default: all channels)
  --dry-run             Generate CSV to stdout, don't email
  --output FILE         Save CSV to file instead of emailing
  --help                Show this help

Environment Variables:
  MEDUSA_URL              Medusa backend URL (default: https://medusajs.psmhome.no)
  MEDUSA_ADMIN_EMAIL      Admin email for authentication
  MEDUSA_ADMIN_PASSWORD   Admin password
  AWS_SES_REGION          SES region (default: ap-south-1)
  AWS_SES_ACCESS_KEY_ID   IAM access key for SES
  AWS_SES_SECRET_ACCESS_KEY IAM secret key for SES
  GST_REPORT_FROM_EMAIL   Sender (default: noreply@chamkileystore.in)
  GST_REPORT_TO_EMAIL     Recipient (default: contact@kalakavya.in)
  GST_RATE                GST % (default: 5)
  SELLER_STATE            Seller state (default: Karnataka)

Examples:
  # Last month's report (auto)
  node scripts/gst-manifest.mjs

  # Custom range, dry run
  node scripts/gst-manifest.mjs --start 2026-09-01 --end 2026-09-30 --dry-run

  # Specific channel, save to file
  node scripts/gst-manifest.mjs --channel "Chamkiley Store" --output gst-sep-2026.csv
`)
  process.exit(0)
}

// ── Configuration ─────────────────────────────────────────────────

const MEDUSA_URL = process.env.MEDUSA_URL || "https://medusajs.psmhome.no"
const ADMIN_EMAIL = process.env.MEDUSA_ADMIN_EMAIL
const ADMIN_PASSWORD = process.env.MEDUSA_ADMIN_PASSWORD
const GST_RATE = parseFloat(process.env.GST_RATE || "5")
const SELLER_STATE = (process.env.SELLER_STATE || "Karnataka").toLowerCase()

const AWS_REGION = process.env.AWS_SES_REGION || "ap-south-1"
const AWS_ACCESS_KEY = process.env.AWS_SES_ACCESS_KEY_ID
const AWS_SECRET_KEY = process.env.AWS_SES_SECRET_ACCESS_KEY
const FROM_EMAIL = process.env.GST_REPORT_FROM_EMAIL || "noreply@chamkileystore.in"
const TO_EMAIL = process.env.GST_REPORT_TO_EMAIL || "contact@kalakavya.in"

const DRY_RUN = hasFlag("dry-run")
const OUTPUT_FILE = getArg("output")
const CHANNEL_FILTER = getArg("channel")

// ── Date Range ────────────────────────────────────────────────────

function getLastMonthRange() {
  const now = new Date()
  const firstOfThisMonth = new Date(now.getFullYear(), now.getMonth(), 1)
  const lastOfPrevMonth = new Date(firstOfThisMonth - 1)
  const firstOfPrevMonth = new Date(lastOfPrevMonth.getFullYear(), lastOfPrevMonth.getMonth(), 1)
  return {
    start: firstOfPrevMonth.toISOString().split("T")[0],
    end: lastOfPrevMonth.toISOString().split("T")[0],
  }
}

const defaultRange = getLastMonthRange()
const START_DATE = getArg("start") || defaultRange.start
const END_DATE = getArg("end") || defaultRange.end

// ── IST Time Helper ───────────────────────────────────────────────

function getISTTimestamp() {
  return new Date().toLocaleString("en-IN", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  })
}

// ── Medusa API ────────────────────────────────────────────────────

let authToken = null

async function authenticate() {
  const res = await fetch(`${MEDUSA_URL}/auth/user/emailpass`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD }),
  })
  const data = await res.json()
  if (!data.token) throw new Error(`Authentication failed: ${JSON.stringify(data)}`)
  authToken = data.token
}

async function adminFetch(path) {
  const res = await fetch(`${MEDUSA_URL}${path}`, {
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${authToken}`,
    },
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`API ${path} returned ${res.status}: ${text.slice(0, 200)}`)
  }
  return res.json()
}

async function fetchAllOrders() {
  const allOrders = []
  let offset = 0
  const limit = 50

  while (true) {
    const params = new URLSearchParams({
      offset: String(offset),
      limit: String(limit),
      created_at: JSON.stringify({
        $gte: `${START_DATE}T00:00:00.000Z`,
        $lte: `${END_DATE}T23:59:59.999Z`,
      }),
      fields: [
        "id", "display_id", "created_at", "email", "total", "subtotal",
        "tax_total", "shipping_total", "discount_total", "currency_code",
        "status", "fulfillment_status", "payment_status",
        "*items", "*items.variant", "*items.variant.product",
        "*shipping_address", "*sales_channel",
      ].join(","),
    })

    const data = await adminFetch(`/admin/orders?${params.toString()}`)
    const orders = data.orders || []
    allOrders.push(...orders)

    if (orders.length < limit) break
    offset += limit
  }

  return allOrders
}

// ── GST Calculation ───────────────────────────────────────────────

function computeGST(order) {
  const customerState = (order.shipping_address?.province || "").toLowerCase()
  const isIntraState = customerState === SELLER_STATE
  const totalAmount = order.total || 0
  const taxableValue = totalAmount / (1 + GST_RATE / 100)
  const gstAmount = totalAmount - taxableValue

  return {
    taxableValue: Math.round(taxableValue * 100) / 100,
    cgst: isIntraState ? Math.round((gstAmount / 2) * 100) / 100 : 0,
    sgst: isIntraState ? Math.round((gstAmount / 2) * 100) / 100 : 0,
    igst: !isIntraState ? Math.round(gstAmount * 100) / 100 : 0,
    totalGST: Math.round(gstAmount * 100) / 100,
    isIntraState,
  }
}

// ── CSV Generation ────────────────────────────────────────────────

function escapeCSV(value) {
  const str = String(value ?? "")
  if (str.includes(",") || str.includes('"') || str.includes("\n")) {
    return `"${str.replace(/"/g, '""')}"`
  }
  return str
}

function generateCSV(orders) {
  const headers = [
    "Invoice No",
    "Order Date",
    "Display ID",
    "Sales Channel",
    "Customer Name",
    "Customer Email",
    "Customer Phone",
    "Billing State",
    "HSN Code",
    "Item Description",
    "Qty",
    "Unit Price (₹)",
    "Taxable Value (₹)",
    "CGST Rate (%)",
    "CGST (₹)",
    "SGST Rate (%)",
    "SGST (₹)",
    "IGST Rate (%)",
    "IGST (₹)",
    "Total Tax (₹)",
    "Invoice Total (₹)",
    "Payment Status",
    "Fulfillment Status",
  ]

  const rows = [headers.map(escapeCSV).join(",")]

  for (const order of orders) {
    const gst = computeGST(order)
    const addr = order.shipping_address || {}
    const channelName = order.sales_channel?.name || "Unknown"
    const orderDate = new Date(order.created_at).toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata" })
    const customerName = `${addr.first_name || ""} ${addr.last_name || ""}`.trim()

    const items = order.items || []
    if (items.length === 0) {
      rows.push([
        escapeCSV(`INV-${order.display_id}`),
        escapeCSV(orderDate),
        escapeCSV(order.display_id),
        escapeCSV(channelName),
        escapeCSV(customerName),
        escapeCSV(order.email),
        escapeCSV(addr.phone || ""),
        escapeCSV(addr.province || ""),
        escapeCSV("6109"),
        escapeCSV("(no items)"),
        escapeCSV(0),
        escapeCSV(0),
        escapeCSV(gst.taxableValue),
        escapeCSV(gst.isIntraState ? GST_RATE / 2 : 0),
        escapeCSV(gst.cgst),
        escapeCSV(gst.isIntraState ? GST_RATE / 2 : 0),
        escapeCSV(gst.sgst),
        escapeCSV(!gst.isIntraState ? GST_RATE : 0),
        escapeCSV(gst.igst),
        escapeCSV(gst.totalGST),
        escapeCSV(order.total || 0),
        escapeCSV(order.payment_status || ""),
        escapeCSV(order.fulfillment_status || ""),
      ].join(","))
    } else {
      for (const item of items) {
        const itemTotal = (item.unit_price || 0) * (item.quantity || 1)
        const itemTaxable = itemTotal / (1 + GST_RATE / 100)
        const itemGST = itemTotal - itemTaxable
        const productTitle = item.variant?.product?.title || item.title || "Product"
        const variantTitle = item.variant?.title || ""
        const description = variantTitle ? `${productTitle} — ${variantTitle}` : productTitle

        rows.push([
          escapeCSV(`INV-${order.display_id}`),
          escapeCSV(orderDate),
          escapeCSV(order.display_id),
          escapeCSV(channelName),
          escapeCSV(customerName),
          escapeCSV(order.email),
          escapeCSV(addr.phone || ""),
          escapeCSV(addr.province || ""),
          escapeCSV("6109"),
          escapeCSV(description),
          escapeCSV(item.quantity || 1),
          escapeCSV(Math.round((item.unit_price || 0) * 100) / 100),
          escapeCSV(Math.round(itemTaxable * 100) / 100),
          escapeCSV(gst.isIntraState ? GST_RATE / 2 : 0),
          escapeCSV(Math.round((gst.isIntraState ? itemGST / 2 : 0) * 100) / 100),
          escapeCSV(gst.isIntraState ? GST_RATE / 2 : 0),
          escapeCSV(Math.round((gst.isIntraState ? itemGST / 2 : 0) * 100) / 100),
          escapeCSV(!gst.isIntraState ? GST_RATE : 0),
          escapeCSV(Math.round((!gst.isIntraState ? itemGST : 0) * 100) / 100),
          escapeCSV(Math.round(itemGST * 100) / 100),
          escapeCSV(Math.round(itemTotal * 100) / 100),
          escapeCSV(order.payment_status || ""),
          escapeCSV(order.fulfillment_status || ""),
        ].join(","))
      }
    }
  }

  return rows.join("\n")
}

// ── Summary ───────────────────────────────────────────────────────

function generateSummary(orders, channelName) {
  let totalRevenue = 0
  let totalTaxable = 0
  let totalCGST = 0
  let totalSGST = 0
  let totalIGST = 0
  let totalGST = 0
  let intraStateCount = 0
  let interStateCount = 0

  for (const order of orders) {
    const gst = computeGST(order)
    totalRevenue += order.total || 0
    totalTaxable += gst.taxableValue
    totalCGST += gst.cgst
    totalSGST += gst.sgst
    totalIGST += gst.igst
    totalGST += gst.totalGST
    if (gst.isIntraState) intraStateCount++
    else interStateCount++
  }

  return `
GST MANIFEST SUMMARY
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Sales Channel:    ${channelName}
Period:           ${START_DATE} to ${END_DATE}
Generated at:     ${getISTTimestamp()} IST
Seller State:     ${SELLER_STATE.charAt(0).toUpperCase() + SELLER_STATE.slice(1)}
GST Rate:         ${GST_RATE}%
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Total Orders:     ${orders.length}
Intra-State:      ${intraStateCount} (CGST + SGST)
Inter-State:      ${interStateCount} (IGST)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Total Revenue:    ₹${totalRevenue.toFixed(2)}
Taxable Value:    ₹${totalTaxable.toFixed(2)}
CGST Collected:   ₹${totalCGST.toFixed(2)}
SGST Collected:   ₹${totalSGST.toFixed(2)}
IGST Collected:   ₹${totalIGST.toFixed(2)}
Total GST:        ₹${totalGST.toFixed(2)}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`.trim()
}

// ── Email via AWS SES ─────────────────────────────────────────────

async function sendEmailViaSES(subject, textBody, csvContent, csvFilename) {
  if (!AWS_ACCESS_KEY || !AWS_SECRET_KEY) {
    console.error("⚠️  AWS SES credentials not configured — skipping email delivery")
    console.log("   Set AWS_SES_ACCESS_KEY_ID and AWS_SES_SECRET_ACCESS_KEY to enable email")
    return false
  }

  const boundary = `----=_Part_${Date.now()}`
  const csvBase64 = Buffer.from(csvContent).toString("base64")

  const rawEmail = [
    `From: ${FROM_EMAIL}`,
    `To: ${TO_EMAIL}`,
    `Subject: ${subject}`,
    `MIME-Version: 1.0`,
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
    ``,
    `--${boundary}`,
    `Content-Type: text/plain; charset=UTF-8`,
    `Content-Transfer-Encoding: 7bit`,
    ``,
    textBody,
    ``,
    `--${boundary}`,
    `Content-Type: text/csv; name="${csvFilename}"`,
    `Content-Disposition: attachment; filename="${csvFilename}"`,
    `Content-Transfer-Encoding: base64`,
    ``,
    csvBase64,
    ``,
    `--${boundary}--`,
  ].join("\r\n")

  const rawBase64 = Buffer.from(rawEmail).toString("base64")

  // SES v2 SendRawEmail using AWS Signature v4
  const endpoint = `https://email.${AWS_REGION}.amazonaws.com`
  const body = new URLSearchParams({
    Action: "SendRawEmail",
    "RawMessage.Data": rawBase64,
    Version: "2010-12-01",
  })

  // Simple AWS v4 signing for SES
  const now = new Date()
  const dateStamp = now.toISOString().replace(/[-:]/g, "").split(".")[0] + "Z"
  const shortDate = dateStamp.slice(0, 8)

  const { createHmac, createHash } = await import("crypto")

  function hmac(key, data) {
    return createHmac("sha256", key).update(data).digest()
  }
  function sha256(data) {
    return createHash("sha256").update(data).digest("hex")
  }

  const bodyStr = body.toString()
  const payloadHash = sha256(bodyStr)
  const canonicalHeaders = `content-type:application/x-www-form-urlencoded\nhost:email.${AWS_REGION}.amazonaws.com\nx-amz-date:${dateStamp}\n`
  const signedHeaders = "content-type;host;x-amz-date"
  const canonicalRequest = `POST\n/\n\n${canonicalHeaders}\n${signedHeaders}\n${payloadHash}`
  const credentialScope = `${shortDate}/${AWS_REGION}/ses/aws4_request`
  const stringToSign = `AWS4-HMAC-SHA256\n${dateStamp}\n${credentialScope}\n${sha256(canonicalRequest)}`

  const kDate = hmac(`AWS4${AWS_SECRET_KEY}`, shortDate)
  const kRegion = hmac(kDate, AWS_REGION)
  const kService = hmac(kRegion, "ses")
  const kSigning = hmac(kService, "aws4_request")
  const signature = createHmac("sha256", kSigning).update(stringToSign).digest("hex")

  const authorization = `AWS4-HMAC-SHA256 Credential=${AWS_ACCESS_KEY}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`

  const res = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "X-Amz-Date": dateStamp,
      Authorization: authorization,
    },
    body: bodyStr,
  })

  if (!res.ok) {
    const errText = await res.text()
    console.error(`❌ SES email failed (${res.status}): ${errText.slice(0, 300)}`)
    return false
  }

  console.log(`✅ Email sent to ${TO_EMAIL}`)
  return true
}

// ── Main ──────────────────────────────────────────────────────────

async function main() {
  console.log(`\n📊 GST Manifest Report Generator`)
  console.log(`   Period: ${START_DATE} to ${END_DATE}`)
  console.log(`   Backend: ${MEDUSA_URL}`)
  console.log(`   Channel: ${CHANNEL_FILTER || "All channels"}`)
  console.log(`   Mode: ${DRY_RUN ? "Dry run (no email)" : OUTPUT_FILE ? `Save to ${OUTPUT_FILE}` : "Email to " + TO_EMAIL}\n`)

  if (!ADMIN_EMAIL || !ADMIN_PASSWORD) {
    console.error("❌ Missing MEDUSA_ADMIN_EMAIL and/or MEDUSA_ADMIN_PASSWORD")
    console.error("   Set these environment variables to authenticate with the Medusa Admin API")
    process.exit(1)
  }

  // 1. Authenticate
  console.log("🔐 Authenticating with Medusa Admin...")
  await authenticate()
  console.log("   ✅ Authenticated\n")

  // 2. Fetch orders
  console.log("📦 Fetching orders...")
  let orders = await fetchAllOrders()
  console.log(`   Found ${orders.length} orders in date range\n`)

  // 3. Filter to paid orders only
  orders = orders.filter((o) =>
    o.payment_status === "captured" || o.payment_status === "refunded" || o.payment_status === "partially_refunded"
  )
  console.log(`   ${orders.length} paid orders (payment captured/refunded)\n`)

  if (orders.length === 0) {
    console.log("ℹ️  No paid orders found for this period. Nothing to report.")
    process.exit(0)
  }

  // 4. Group by sales channel
  const channelGroups = new Map()
  for (const order of orders) {
    const channelName = order.sales_channel?.name || "Default"
    if (CHANNEL_FILTER && channelName !== CHANNEL_FILTER) continue
    if (!channelGroups.has(channelName)) channelGroups.set(channelName, [])
    channelGroups.get(channelName).push(order)
  }

  if (channelGroups.size === 0) {
    console.log(`ℹ️  No orders found for channel "${CHANNEL_FILTER}"`)
    process.exit(0)
  }

  // 5. Generate reports per channel
  const { writeFileSync } = await import("fs")

  for (const [channelName, channelOrders] of channelGroups) {
    console.log(`\n📄 Processing: ${channelName} (${channelOrders.length} orders)`)

    const summary = generateSummary(channelOrders, channelName)
    console.log(summary)

    const csv = generateCSV(channelOrders)
    const sanitizedChannel = channelName.replace(/[^a-zA-Z0-9]/g, "-")
    const csvFilename = `${sanitizedChannel}-GST-Manifest-${START_DATE}-to-${END_DATE}.csv`
    const subject = `${sanitizedChannel}-GST-Manifest-${START_DATE} - ${END_DATE}@Generated at ${getISTTimestamp()}`

    if (DRY_RUN) {
      console.log(`\n--- CSV Preview (first 20 lines) ---`)
      console.log(csv.split("\n").slice(0, 20).join("\n"))
      console.log(`--- (${csv.split("\n").length} total rows) ---\n`)
    } else if (OUTPUT_FILE) {
      const outputPath = OUTPUT_FILE.includes(channelName) ? OUTPUT_FILE : `${sanitizedChannel}-${OUTPUT_FILE}`
      writeFileSync(outputPath, csv, "utf-8")
      console.log(`💾 Saved to: ${outputPath}`)
    } else {
      const emailBody = `${summary}\n\nFull invoice manifest attached as CSV.\n\nThis report was auto-generated on ${getISTTimestamp()} IST.\nTo regenerate: node scripts/gst-manifest.mjs --start ${START_DATE} --end ${END_DATE} --channel "${channelName}"`

      await sendEmailViaSES(subject, emailBody, csv, csvFilename)
    }
  }

  console.log("\n✅ GST manifest generation complete\n")
}

main().catch((err) => {
  console.error(`\n❌ Fatal error: ${err.message}`)
  if (err.stack) console.error(err.stack)
  process.exit(1)
})
