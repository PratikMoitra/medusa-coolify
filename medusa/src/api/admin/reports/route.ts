import type { MedusaRequest, MedusaResponse } from "@medusajs/framework"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"

/**
 * Admin Reports API — Chamkiley Store
 *
 * Comprehensive reporting engine for sales analytics, compliance,
 * investor metrics, and operational reports.
 *
 * ─── USAGE ───────────────────────────────────────────────────
 *
 * GET /admin/reports?type=<type>&period=<period>&from=<date>&to=<date>&format=<format>&sales_channel=<id>
 *
 * Query Parameters:
 *   type          (required) Report type — see list below
 *   period        "daily" | "weekly" | "monthly" | "quarterly" | "yearly" | "custom"
 *   from          Start date YYYY-MM-DD (defaults to start of current month)
 *   to            End date YYYY-MM-DD (defaults to today)
 *   format        "json" (default) | "csv"
 *   sales_channel Sales channel ID to filter (omit for all channels)
 *   status        Order status filter: "pending" | "completed" | "canceled" | "archived"
 *
 * ─── REPORT TYPES ────────────────────────────────────────────
 *
 *   SALES & REVENUE
 *     sales           Detailed order-level sales report with line items
 *     summary         Executive summary — KPIs, revenue, AOV, units sold
 *     daily_trend     Day-by-day revenue and order count trend
 *
 *   REGIONAL & MARKETING
 *     regional        State/city breakdown for Meta ad targeting
 *     pincode_heatmap Top pincodes by volume — for hyperlocal ads
 *
 *   CUSTOMER & CONTACTS
 *     customers       Unique customer list with lifetime metrics
 *     emails          Deduplicated email list (newsletter/marketing)
 *     phones          Deduplicated phone number list (WhatsApp/SMS)
 *     buyers          Buyer analytics with IP, device, location
 *
 *   INVENTORY
 *     stock           Current inventory with low-stock alerts
 *
 *   COMPLIANCE & FINANCE
 *     gst             GST report: CGST/SGST (intra-KA) vs IGST breakdown
 *     manifest        Shipping manifest with address and tracking
 *     transactions    Payment transaction log (Razorpay IDs)
 *
 *   SALES CHANNELS
 *     channels        List all available sales channels
 *
 * ─── EXAMPLES ────────────────────────────────────────────────
 *
 *   Monthly sales CSV:
 *     GET /admin/reports?type=sales&period=monthly&format=csv
 *
 *   Q3 GST report:
 *     GET /admin/reports?type=gst&from=2026-07-01&to=2026-09-30
 *
 *   Regional breakdown for website channel only:
 *     GET /admin/reports?type=regional&period=monthly&sales_channel=sc_01J...
 *
 *   Email list (all time):
 *     GET /admin/reports?type=emails&period=custom&from=2020-01-01
 *
 *   Executive investor summary (this quarter):
 *     GET /admin/reports?type=summary&period=quarterly
 */

// ─── Helpers ──────────────────────────────────────────────────

function getDateRange(
  period?: string,
  from?: string,
  to?: string
): { startDate: Date; endDate: Date } {
  const now = new Date()
  let startDate: Date
  const endDate = to ? new Date(to + "T23:59:59.999Z") : now

  switch (period) {
    case "daily":
      startDate = new Date(now.toISOString().split("T")[0] + "T00:00:00.000Z")
      break
    case "weekly":
      startDate = new Date(now)
      startDate.setDate(startDate.getDate() - 7)
      startDate.setHours(0, 0, 0, 0)
      break
    case "monthly":
      startDate = new Date(now.getFullYear(), now.getMonth(), 1)
      break
    case "quarterly": {
      const qMonth = Math.floor(now.getMonth() / 3) * 3
      startDate = new Date(now.getFullYear(), qMonth, 1)
      break
    }
    case "yearly":
      startDate = new Date(now.getFullYear(), 0, 1)
      break
    default:
      startDate = from
        ? new Date(from + "T00:00:00.000Z")
        : new Date(now.getFullYear(), now.getMonth(), 1)
  }

  return { startDate, endDate }
}

function toCsv(headers: string[], rows: Record<string, any>[]): string {
  const esc = (val: any) => {
    const s = val == null ? "" : String(val)
    return s.includes(",") || s.includes('"') || s.includes("\n")
      ? `"${s.replace(/"/g, '""')}"`
      : s
  }
  return [
    headers.join(","),
    ...rows.map((r) => headers.map((h) => esc(r[h])).join(",")),
  ].join("\n")
}

function periodLabel(start: Date, end: Date): Record<string, string> {
  return {
    from: start.toISOString().split("T")[0],
    to: end.toISOString().split("T")[0],
  }
}

interface DateFilter {
  $gte: string
  $lte: string
}

function dateFilter(s: Date, e: Date): DateFilter {
  return { $gte: s.toISOString(), $lte: e.toISOString() }
}

async function fetchOrders(
  container: Record<string, any>,
  fields: string[],
  startDate: Date,
  endDate: Date,
  salesChannelId?: string,
  statusFilter?: string
) {
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const filters: Record<string, any> = {
    created_at: dateFilter(startDate, endDate),
  }
  if (salesChannelId) filters.sales_channel_id = salesChannelId
  if (statusFilter) filters.status = statusFilter

  const { data } = await query.graph({ entity: "order", filters, fields })
  return data as any[]
}

// ─── Report Generators ───────────────────────────────────────

async function reportSales(
  container: Record<string, any>,
  startDate: Date,
  endDate: Date,
  salesChannelId?: string,
  statusFilter?: string
) {
  const orders = await fetchOrders(
    container,
    [
      "id", "display_id", "status", "created_at",
      "total", "subtotal", "tax_total", "shipping_total", "discount_total",
      "currency_code", "metadata", "sales_channel_id",
      "items.title", "items.quantity", "items.unit_price", "items.total",
      "items.variant.sku",
      "shipping_address.city", "shipping_address.province",
      "shipping_address.postal_code", "shipping_address.phone",
      "customer.email", "customer.first_name", "customer.last_name",
    ],
    startDate, endDate, salesChannelId, statusFilter
  )

  const rows = orders.map((o) => ({
    order_id: o.display_id,
    invoice: o.metadata?.invoice_number || "",
    date: o.created_at?.split?.("T")?.[0] ?? new Date(o.created_at).toISOString().split("T")[0],
    customer: [o.customer?.first_name, o.customer?.last_name].filter(Boolean).join(" "),
    email: o.customer?.email || "",
    phone: o.shipping_address?.phone || "",
    city: o.shipping_address?.city || "",
    state: o.shipping_address?.province || "",
    pincode: o.shipping_address?.postal_code || "",
    items: o.items?.map((i: any) => `${i.title} x${i.quantity}`).join("; ") || "",
    skus: o.items?.map((i: any) => i.variant?.sku).filter(Boolean).join(", ") || "",
    subtotal: o.subtotal ?? 0,
    tax: o.tax_total ?? 0,
    shipping: o.shipping_total ?? 0,
    discount: o.discount_total ?? 0,
    total: o.total ?? 0,
    status: o.status || "",
    payment_method: o.metadata?.payment_method || "",
    razorpay_order: o.metadata?.razorpay_order_id || "",
    sales_channel_id: o.sales_channel_id || "",
  }))

  return {
    total_orders: orders.length,
    total_revenue: orders.reduce((s, o) => s + (o.total ?? 0), 0),
    currency: "INR",
    period: periodLabel(startDate, endDate),
    orders: rows,
  }
}

async function reportSummary(
  container: Record<string, any>,
  startDate: Date,
  endDate: Date,
  salesChannelId?: string
) {
  const orders = await fetchOrders(
    container,
    [
      "id", "total", "subtotal", "tax_total", "shipping_total",
      "discount_total", "items.quantity", "items.unit_price",
      "shipping_address.province", "shipping_address.city",
      "customer.id", "customer.email", "status", "created_at",
    ],
    startDate, endDate, salesChannelId
  )

  const completed = orders.filter((o) => o.status !== "canceled")
  const canceled = orders.filter((o) => o.status === "canceled")
  const revenue = completed.reduce((s, o) => s + (o.total ?? 0), 0)
  const itemsSold = completed.reduce(
    (s, o) => s + (o.items?.reduce((a: number, i: any) => a + (i.quantity ?? 0), 0) ?? 0), 0
  )
  const uniqueCustomers = new Set(completed.map((o) => o.customer?.id).filter(Boolean)).size
  const uniqueEmails = new Set(completed.map((o) => o.customer?.email).filter(Boolean)).size
  const topStates: Record<string, number> = {}
  const topCities: Record<string, number> = {}
  for (const o of completed) {
    const st = o.shipping_address?.province || "Unknown"
    const ci = o.shipping_address?.city || "Unknown"
    topStates[st] = (topStates[st] || 0) + (o.total ?? 0)
    topCities[ci] = (topCities[ci] || 0) + (o.total ?? 0)
  }

  return {
    kpis: {
      total_orders: completed.length,
      canceled_orders: canceled.length,
      total_revenue: revenue,
      total_tax_collected: completed.reduce((s, o) => s + (o.tax_total ?? 0), 0),
      total_shipping_revenue: completed.reduce((s, o) => s + (o.shipping_total ?? 0), 0),
      total_discounts_given: completed.reduce((s, o) => s + (o.discount_total ?? 0), 0),
      net_revenue: completed.reduce((s, o) => s + (o.subtotal ?? 0), 0),
      avg_order_value: completed.length ? Math.round(revenue / completed.length) : 0,
      total_items_sold: itemsSold,
      unique_customers: uniqueCustomers,
      unique_email_addresses: uniqueEmails,
      cancellation_rate: orders.length
        ? `${((canceled.length / orders.length) * 100).toFixed(1)}%`
        : "0%",
    },
    top_states: Object.entries(topStates)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([state, revenue]) => ({ state, revenue })),
    top_cities: Object.entries(topCities)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([city, revenue]) => ({ city, revenue })),
    currency: "INR",
    period: periodLabel(startDate, endDate),
  }
}

async function reportDailyTrend(
  container: Record<string, any>,
  startDate: Date,
  endDate: Date,
  salesChannelId?: string
) {
  const orders = await fetchOrders(
    container,
    ["id", "total", "items.quantity", "created_at", "status"],
    startDate, endDate, salesChannelId
  )

  const byDay: Record<string, { orders: number; revenue: number; items: number }> = {}
  for (const o of orders) {
    if (o.status === "canceled") continue
    const day = new Date(o.created_at).toISOString().split("T")[0]
    if (!byDay[day]) byDay[day] = { orders: 0, revenue: 0, items: 0 }
    byDay[day].orders++
    byDay[day].revenue += o.total ?? 0
    byDay[day].items += o.items?.reduce((a: number, i: any) => a + (i.quantity ?? 0), 0) ?? 0
  }

  const trend = Object.entries(byDay)
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([date, data]) => ({ date, ...data }))

  return { trend, period: periodLabel(startDate, endDate) }
}

async function reportRegional(
  container: Record<string, any>,
  startDate: Date,
  endDate: Date,
  salesChannelId?: string
) {
  const orders = await fetchOrders(
    container,
    [
      "id", "total", "items.quantity",
      "shipping_address.city", "shipping_address.province",
      "shipping_address.postal_code", "metadata", "status",
    ],
    startDate, endDate, salesChannelId
  )

  const completed = orders.filter((o) => o.status !== "canceled")
  const byState: Record<string, { orders: number; revenue: number; items: number }> = {}
  const byCity: Record<string, { orders: number; revenue: number; items: number; state: string }> = {}

  for (const o of completed) {
    const state = o.shipping_address?.province || o.metadata?.buyer_state || "Unknown"
    const city = o.shipping_address?.city || o.metadata?.buyer_city || "Unknown"
    const items = o.items?.reduce((s: number, i: any) => s + (i.quantity ?? 0), 0) ?? 0

    if (!byState[state]) byState[state] = { orders: 0, revenue: 0, items: 0 }
    byState[state].orders++
    byState[state].revenue += o.total ?? 0
    byState[state].items += items

    const ck = `${city}|${state}`
    if (!byCity[ck]) byCity[ck] = { orders: 0, revenue: 0, items: 0, state }
    byCity[ck].orders++
    byCity[ck].revenue += o.total ?? 0
    byCity[ck].items += items
  }

  return {
    total_orders: completed.length,
    total_revenue: completed.reduce((s, o) => s + (o.total ?? 0), 0),
    by_state: Object.entries(byState)
      .sort((a, b) => b[1].revenue - a[1].revenue)
      .map(([state, d]) => ({ state, ...d, pct: `${((d.revenue / Math.max(completed.reduce((s, o) => s + (o.total ?? 0), 0), 1)) * 100).toFixed(1)}%` })),
    top_cities: Object.entries(byCity)
      .sort((a, b) => b[1].revenue - a[1].revenue)
      .slice(0, 30)
      .map(([key, d]) => ({ city: key.split("|")[0], ...d })),
    period: periodLabel(startDate, endDate),
  }
}

async function reportPincodeHeatmap(
  container: Record<string, any>,
  startDate: Date,
  endDate: Date,
  salesChannelId?: string
) {
  const orders = await fetchOrders(
    container,
    [
      "id", "total", "items.quantity", "status",
      "shipping_address.postal_code", "shipping_address.city",
      "shipping_address.province",
    ],
    startDate, endDate, salesChannelId
  )

  const completed = orders.filter((o) => o.status !== "canceled")
  const byPin: Record<string, { orders: number; revenue: number; city: string; state: string }> = {}

  for (const o of completed) {
    const pin = o.shipping_address?.postal_code || "Unknown"
    if (!byPin[pin]) byPin[pin] = {
      orders: 0, revenue: 0,
      city: o.shipping_address?.city || "",
      state: o.shipping_address?.province || "",
    }
    byPin[pin].orders++
    byPin[pin].revenue += o.total ?? 0
  }

  return {
    pincodes: Object.entries(byPin)
      .sort((a, b) => b[1].orders - a[1].orders)
      .slice(0, 100)
      .map(([pincode, d]) => ({ pincode, ...d })),
    period: periodLabel(startDate, endDate),
  }
}

async function reportCustomers(
  container: Record<string, any>,
  startDate: Date,
  endDate: Date,
  salesChannelId?: string
) {
  const orders = await fetchOrders(
    container,
    [
      "id", "total", "created_at", "status",
      "customer.id", "customer.email", "customer.first_name",
      "customer.last_name", "customer.phone", "customer.created_at",
      "shipping_address.city", "shipping_address.province",
      "shipping_address.phone",
    ],
    startDate, endDate, salesChannelId
  )

  const completed = orders.filter((o) => o.status !== "canceled")
  const custMap: Record<string, any> = {}

  for (const o of completed) {
    const cid = o.customer?.id || o.customer?.email || "guest"
    if (!custMap[cid]) {
      custMap[cid] = {
        customer_id: o.customer?.id || "",
        name: [o.customer?.first_name, o.customer?.last_name].filter(Boolean).join(" "),
        email: o.customer?.email || "",
        phone: o.shipping_address?.phone || o.customer?.phone || "",
        city: o.shipping_address?.city || "",
        state: o.shipping_address?.province || "",
        first_order: o.created_at,
        last_order: o.created_at,
        total_orders: 0,
        lifetime_value: 0,
        registered_at: o.customer?.created_at || "",
      }
    }
    custMap[cid].total_orders++
    custMap[cid].lifetime_value += o.total ?? 0
    if (o.created_at > custMap[cid].last_order) custMap[cid].last_order = o.created_at
    if (o.created_at < custMap[cid].first_order) custMap[cid].first_order = o.created_at
  }

  const customers = Object.values(custMap).sort((a: any, b: any) => b.lifetime_value - a.lifetime_value)

  return {
    total_customers: customers.length,
    avg_lifetime_value: customers.length
      ? Math.round(customers.reduce((s: number, c: any) => s + c.lifetime_value, 0) / customers.length)
      : 0,
    repeat_buyers: customers.filter((c: any) => c.total_orders > 1).length,
    customers,
    period: periodLabel(startDate, endDate),
  }
}

async function reportEmails(
  container: Record<string, any>,
  startDate: Date,
  endDate: Date,
  salesChannelId?: string
) {
  const orders = await fetchOrders(
    container,
    ["id", "customer.email", "customer.first_name", "customer.last_name", "created_at"],
    startDate, endDate, salesChannelId
  )

  const emailMap: Record<string, { name: string; first_seen: string }> = {}
  for (const o of orders) {
    const email = o.customer?.email
    if (!email) continue
    if (!emailMap[email]) {
      emailMap[email] = {
        name: [o.customer?.first_name, o.customer?.last_name].filter(Boolean).join(" "),
        first_seen: o.created_at,
      }
    }
  }

  const emails = Object.entries(emailMap)
    .map(([email, d]) => ({ email, ...d }))
    .sort((a, b) => a.email.localeCompare(b.email))

  return { total: emails.length, emails, period: periodLabel(startDate, endDate) }
}

async function reportPhones(
  container: Record<string, any>,
  startDate: Date,
  endDate: Date,
  salesChannelId?: string
) {
  const orders = await fetchOrders(
    container,
    [
      "id", "shipping_address.phone", "shipping_address.city",
      "shipping_address.province",
      "customer.first_name", "customer.last_name", "customer.email",
      "created_at",
    ],
    startDate, endDate, salesChannelId
  )

  const phoneMap: Record<string, any> = {}
  for (const o of orders) {
    const phone = o.shipping_address?.phone
    if (!phone) continue
    if (!phoneMap[phone]) {
      phoneMap[phone] = {
        name: [o.customer?.first_name, o.customer?.last_name].filter(Boolean).join(" "),
        email: o.customer?.email || "",
        city: o.shipping_address?.city || "",
        state: o.shipping_address?.province || "",
      }
    }
  }

  const phones = Object.entries(phoneMap)
    .map(([phone, d]) => ({ phone, ...(d as any) }))
    .sort((a, b) => a.phone.localeCompare(b.phone))

  return { total: phones.length, phones, period: periodLabel(startDate, endDate) }
}

async function reportBuyers(
  container: Record<string, any>,
  startDate: Date,
  endDate: Date,
  salesChannelId?: string
) {
  const orders = await fetchOrders(
    container,
    [
      "id", "display_id", "created_at", "total", "metadata", "status",
      "shipping_address.city", "shipping_address.province",
      "shipping_address.postal_code",
      "customer.email", "customer.first_name", "customer.last_name",
    ],
    startDate, endDate, salesChannelId
  )

  const rows = orders.map((o) => ({
    order_id: o.display_id,
    date: new Date(o.created_at).toISOString().split("T")[0],
    customer: [o.customer?.first_name, o.customer?.last_name].filter(Boolean).join(" "),
    email: o.customer?.email || "",
    city: o.shipping_address?.city || "",
    state: o.shipping_address?.province || "",
    pincode: o.shipping_address?.postal_code || "",
    ip_address: o.metadata?.buyer_ip || "",
    user_agent: o.metadata?.buyer_user_agent || "",
    purchase_timestamp_ist: o.metadata?.buyer_purchase_timestamp_ist || "",
    total: o.total ?? 0,
    status: o.status || "",
  }))

  return { total: rows.length, buyers: rows, period: periodLabel(startDate, endDate) }
}

async function reportStock(container: Record<string, any>) {
  const query = container.resolve(ContainerRegistrationKeys.QUERY)

  const { data: products } = await query.graph({
    entity: "product",
    fields: [
      "id", "title", "handle", "status",
      "variants.id", "variants.title", "variants.sku",
      "variants.inventory_quantity", "variants.manage_inventory",
    ],
  })

  const rows: any[] = []
  let total = 0, low = 0, oos = 0

  for (const p of products as any[]) {
    for (const v of p.variants || []) {
      const qty = v.inventory_quantity ?? 0
      total += qty
      if (qty === 0) oos++
      else if (qty <= 5) low++
      rows.push({
        product: p.title, variant: v.title || "Default",
        sku: v.sku || "", stock: qty,
        manage_inventory: v.manage_inventory ?? false,
        status: p.status, handle: p.handle,
      })
    }
  }
  rows.sort((a, b) => a.stock - b.stock)

  return {
    summary: { total_products: (products as any[]).length, total_variants: rows.length, total_stock: total, low_stock: low, out_of_stock: oos },
    items: rows,
  }
}

async function reportGst(
  container: Record<string, any>,
  startDate: Date,
  endDate: Date,
  salesChannelId?: string
) {
  const orders = await fetchOrders(
    container,
    [
      "id", "display_id", "created_at", "total", "subtotal",
      "tax_total", "shipping_total", "currency_code", "metadata", "status",
      "items.title", "items.quantity", "items.unit_price",
      "items.total", "items.tax_total",
      "shipping_address.city", "shipping_address.province",
      "shipping_address.postal_code",
      "customer.email",
    ],
    startDate, endDate, salesChannelId
  )

  const completed = orders.filter((o) => o.status !== "canceled")
  const intraKA = completed.filter((o) => o.shipping_address?.province?.toLowerCase()?.includes("karnataka"))
  const interState = completed.filter((o) => !o.shipping_address?.province?.toLowerCase()?.includes("karnataka"))

  const rows = completed.map((o) => {
    const intra = o.shipping_address?.province?.toLowerCase()?.includes("karnataka")
    const tax = o.tax_total ?? 0
    return {
      invoice_number: o.metadata?.invoice_number || `#${o.display_id}`,
      date: new Date(o.created_at).toISOString().split("T")[0],
      customer_email: o.customer?.email || "",
      state: o.shipping_address?.province || "",
      hsn_code: "6109",
      taxable_value: o.subtotal ?? 0,
      cgst: intra ? Math.round(tax / 2) : 0,
      sgst: intra ? Math.round(tax / 2) : 0,
      igst: intra ? 0 : tax,
      total_tax: tax,
      total: o.total ?? 0,
    }
  })

  return {
    summary: {
      total_orders: completed.length,
      total_taxable_value: completed.reduce((s, o) => s + (o.subtotal ?? 0), 0),
      total_tax_collected: completed.reduce((s, o) => s + (o.tax_total ?? 0), 0),
      total_revenue: completed.reduce((s, o) => s + (o.total ?? 0), 0),
      intra_state_orders: intraKA.length,
      inter_state_orders: interState.length,
      cgst_total: Math.round(intraKA.reduce((s, o) => s + ((o.tax_total ?? 0) / 2), 0)),
      sgst_total: Math.round(intraKA.reduce((s, o) => s + ((o.tax_total ?? 0) / 2), 0)),
      igst_total: interState.reduce((s, o) => s + (o.tax_total ?? 0), 0),
      currency: "INR",
    },
    invoices: rows,
    period: periodLabel(startDate, endDate),
  }
}

async function reportManifest(
  container: Record<string, any>,
  startDate: Date,
  endDate: Date,
  salesChannelId?: string
) {
  const orders = await fetchOrders(
    container,
    [
      "id", "display_id", "created_at", "total", "metadata", "status",
      "items.title", "items.quantity", "items.variant.sku",
      "shipping_address.first_name", "shipping_address.last_name",
      "shipping_address.address_1", "shipping_address.address_2",
      "shipping_address.city", "shipping_address.province",
      "shipping_address.postal_code", "shipping_address.phone",
      "customer.email",
    ],
    startDate, endDate, salesChannelId
  )

  const rows = orders.map((o) => {
    const a = o.shipping_address || {}
    return {
      order_id: o.display_id,
      invoice: o.metadata?.invoice_number || "",
      date: new Date(o.created_at).toISOString().split("T")[0],
      customer_name: [a.first_name, a.last_name].filter(Boolean).join(" "),
      phone: a.phone || "",
      email: o.customer?.email || "",
      address: [a.address_1, a.address_2].filter(Boolean).join(", "),
      city: a.city || "",
      state: a.province || "",
      pincode: a.postal_code || "",
      items: o.items?.map((i: any) => `${i.title} x${i.quantity} (${i.variant?.sku || ""})`).join("; ") || "",
      total: o.total ?? 0,
      status: o.status || "",
      shiprocket_order_id: o.metadata?.shiprocket_order_id || "",
      tracking_number: o.metadata?.tracking?.number || "",
      carrier: o.metadata?.tracking?.carrier || "",
    }
  })

  return { total: orders.length, manifest: rows, period: periodLabel(startDate, endDate) }
}

async function reportTransactions(
  container: Record<string, any>,
  startDate: Date,
  endDate: Date,
  salesChannelId?: string
) {
  const orders = await fetchOrders(
    container,
    [
      "id", "display_id", "created_at", "total", "status",
      "metadata", "currency_code",
      "customer.email",
    ],
    startDate, endDate, salesChannelId
  )

  const rows = orders.map((o) => ({
    order_id: o.display_id,
    invoice: o.metadata?.invoice_number || "",
    date: new Date(o.created_at).toISOString().split("T")[0],
    email: o.customer?.email || "",
    amount: o.total ?? 0,
    currency: o.currency_code || "inr",
    payment_method: o.metadata?.payment_method || "",
    razorpay_order_id: o.metadata?.razorpay_order_id || "",
    razorpay_payment_ids: (o.metadata?.razorpay_payment_ids || []).join(", "),
    status: o.status || "",
  }))

  return {
    total: orders.length,
    total_amount: orders.reduce((s, o) => s + (o.total ?? 0), 0),
    transactions: rows,
    period: periodLabel(startDate, endDate),
  }
}

async function reportChannels(container: Record<string, any>) {
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  try {
    const { data } = await query.graph({
      entity: "sales_channel",
      fields: ["id", "name", "description", "is_disabled"],
    })
    return { channels: data }
  } catch {
    return { channels: [], note: "Sales channels not available or not configured" }
  }
}

// ─── CSV mapping per report type ──────────────────────────────

const CSV_CONFIG: Record<string, { headers: string[]; dataKey: string }> = {
  sales:       { headers: ["order_id","invoice","date","customer","email","phone","city","state","pincode","items","skus","subtotal","tax","shipping","discount","total","status","payment_method","razorpay_order"], dataKey: "orders" },
  daily_trend: { headers: ["date","orders","revenue","items"], dataKey: "trend" },
  regional:    { headers: ["state","orders","revenue","items","pct"], dataKey: "by_state" },
  pincode_heatmap: { headers: ["pincode","city","state","orders","revenue"], dataKey: "pincodes" },
  customers:   { headers: ["customer_id","name","email","phone","city","state","total_orders","lifetime_value","first_order","last_order"], dataKey: "customers" },
  emails:      { headers: ["email","name","first_seen"], dataKey: "emails" },
  phones:      { headers: ["phone","name","email","city","state"], dataKey: "phones" },
  buyers:      { headers: ["order_id","date","customer","email","city","state","pincode","ip_address","purchase_timestamp_ist","total","status"], dataKey: "buyers" },
  stock:       { headers: ["product","variant","sku","stock","status","handle"], dataKey: "items" },
  gst:         { headers: ["invoice_number","date","customer_email","state","hsn_code","taxable_value","cgst","sgst","igst","total_tax","total"], dataKey: "invoices" },
  manifest:    { headers: ["order_id","invoice","date","customer_name","phone","email","address","city","state","pincode","items","total","status","tracking_number","carrier"], dataKey: "manifest" },
  transactions:{ headers: ["order_id","invoice","date","email","amount","currency","payment_method","razorpay_order_id","razorpay_payment_ids","status"], dataKey: "transactions" },
}

// ─── Route Handler ────────────────────────────────────────────

export async function GET(req: MedusaRequest, res: MedusaResponse) {
  try {
    const url = new URL(req.url || "", `http://${req.headers.get?.("host") || "localhost"}`)
    const reportType = url.searchParams.get("type")
    const period = url.searchParams.get("period") || "monthly"
    const from = url.searchParams.get("from") || undefined
    const to = url.searchParams.get("to") || undefined
    const format = url.searchParams.get("format") || "json"
    const salesChannelId = url.searchParams.get("sales_channel") || undefined
    const statusFilter = url.searchParams.get("status") || undefined

    if (!reportType) {
      return res.status(400).json({
        error: "Missing 'type' query parameter",
        available_types: Object.keys(CSV_CONFIG).concat(["summary", "channels"]),
        filters: ["period", "from", "to", "sales_channel", "status", "format"],
        examples: [
          "GET /admin/reports?type=summary&period=monthly",
          "GET /admin/reports?type=sales&period=weekly&format=csv",
          "GET /admin/reports?type=regional&from=2026-01-01&to=2026-12-31",
          "GET /admin/reports?type=gst&period=quarterly",
          "GET /admin/reports?type=emails&period=yearly",
          "GET /admin/reports?type=stock",
          "GET /admin/reports?type=channels",
          "GET /admin/reports?type=sales&sales_channel=sc_01J...",
        ],
      })
    }

    const { startDate, endDate } = getDateRange(period, from, to)
    let data: any

    switch (reportType) {
      case "sales":          data = await reportSales(req.scope, startDate, endDate, salesChannelId, statusFilter); break
      case "summary":        data = await reportSummary(req.scope, startDate, endDate, salesChannelId); break
      case "daily_trend":    data = await reportDailyTrend(req.scope, startDate, endDate, salesChannelId); break
      case "regional":       data = await reportRegional(req.scope, startDate, endDate, salesChannelId); break
      case "pincode_heatmap":data = await reportPincodeHeatmap(req.scope, startDate, endDate, salesChannelId); break
      case "customers":      data = await reportCustomers(req.scope, startDate, endDate, salesChannelId); break
      case "emails":         data = await reportEmails(req.scope, startDate, endDate, salesChannelId); break
      case "phones":         data = await reportPhones(req.scope, startDate, endDate, salesChannelId); break
      case "buyers":         data = await reportBuyers(req.scope, startDate, endDate, salesChannelId); break
      case "stock":          data = await reportStock(req.scope); break
      case "gst":            data = await reportGst(req.scope, startDate, endDate, salesChannelId); break
      case "manifest":       data = await reportManifest(req.scope, startDate, endDate, salesChannelId); break
      case "transactions":   data = await reportTransactions(req.scope, startDate, endDate, salesChannelId); break
      case "channels":       data = await reportChannels(req.scope); break
      default:
        return res.status(400).json({
          error: `Unknown report type: ${reportType}`,
          available_types: Object.keys(CSV_CONFIG).concat(["summary", "channels"]),
        })
    }

    // CSV output
    if (format === "csv" && CSV_CONFIG[reportType]) {
      const { headers, dataKey } = CSV_CONFIG[reportType]
      const csvRows = data[dataKey] || []
      const csv = toCsv(headers, csvRows)
      const filename = `chamkiley_${reportType}_${startDate.toISOString().split("T")[0]}_to_${endDate.toISOString().split("T")[0]}.csv`
      res.setHeader("Content-Type", "text/csv; charset=utf-8")
      res.setHeader("Content-Disposition", `attachment; filename="${filename}"`)
      return res.status(200).send(csv)
    }

    return res.status(200).json({
      report_type: reportType,
      generated_at: new Date().toISOString(),
      ...(salesChannelId ? { sales_channel_filter: salesChannelId } : {}),
      ...data,
    })
  } catch (error: any) {
    console.error("[Reports API] Error:", error)
    return res.status(500).json({ error: error?.message || "Failed to generate report" })
  }
}
