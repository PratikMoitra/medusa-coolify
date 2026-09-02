#!/usr/bin/env tsx
/**
 * WooCommerce to Medusa v2 Migration Script
 *
 * Features:
 *   - Interactive setup — no hardcoded IDs
 *   - Smart R2 image dedup — checks before uploading
 *   - Sales channel: auto-detect, select, or create
 *   - Categories + sub-categories (idempotent)
 *   - Product tags (idempotent)
 *   - Products + variants with prices, dimensions, inventory
 *   - Skip existing products (by handle) unless --force
 *   - --dry-run mode — preview without writing
 *   - Retry logic with exponential backoff
 *
 * Usage:
 *   npx tsx woo-to-medusa.ts                # interactive
 *   npx tsx woo-to-medusa.ts --dry-run      # preview only
 *   npx tsx woo-to-medusa.ts --force        # re-migrate existing products
 *   npx tsx woo-to-medusa.ts --skip-images  # skip R2 upload
 *   npx tsx woo-to-medusa.ts --verbose      # verbose logging
 */

import WooCommerceRestApiDefault from "@woocommerce/woocommerce-rest-api"
import * as crypto from "crypto"
import * as fs from "fs"
import * as path from "path"
import * as os from "os"
import * as readline from "readline"

const WooCommerceRestApi =
  (WooCommerceRestApiDefault as any).default || WooCommerceRestApiDefault

// ── CLI FLAGS ────────────────────────────────────────────────────

const DRY_RUN          = process.argv.includes("--dry-run")
const FORCE            = process.argv.includes("--force")
const SKIP_IMAGES      = process.argv.includes("--skip-images")
const VERBOSE          = process.argv.includes("--verbose")
const PATCH_CATEGORIES = process.argv.includes("--patch-categories")

// ── TYPES ────────────────────────────────────────────────────────

interface WooCategory {
  id: number
  name: string
  slug: string
  parent: number
  count: number
  description: string
  image: { src: string; alt: string } | null
}

interface WooProduct {
  id: number
  name: string
  slug: string
  status: string
  type: string
  sku: string
  price: string
  regular_price: string
  sale_price: string
  description: string
  short_description: string
  categories: Array<{ id: number; name: string; slug: string }>
  images: Array<{ id: number; src: string; alt: string; name: string }>
  attributes: Array<{
    id: number; name: string; position: number
    visible: boolean; variation: boolean; options: string[]
  }>
  variations: number[]
  stock_status: string
  stock_quantity: number | null
  manage_stock: boolean
  weight: string
  dimensions: { length: string; width: string; height: string }
  tags: Array<{ id: number; name: string; slug: string }>
}

interface WooVariation {
  id: number
  sku: string
  price: string
  regular_price: string
  sale_price: string
  stock_status: string
  stock_quantity: number | null
  manage_stock: boolean
  attributes: Array<{ id: number; name: string; option: string }>
  image: { src: string; alt: string } | null
  weight: string
  dimensions: { length: string; width: string; height: string }
}

// ── RUNTIME STATE ─────────────────────────────────────────────────

let authToken = ""
let MEDUSA_URL = ""
let WOO_CLIENT: any = null

// ── PROMPT HELPERS ────────────────────────────────────────────────

function prompt(question: string): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
  return new Promise((resolve) => {
    rl.question(question, (answer) => { rl.close(); resolve(answer.trim()) })
  })
}

async function promptSelect(
  title: string,
  options: Array<{ label: string; value: string }>,
  extra?: string
): Promise<string> {
  console.log(`\n${title}`)
  options.forEach((o, i) => console.log(`  ${i + 1}) ${o.label}`))
  if (extra) console.log(`  ${options.length + 1}) ${extra}`)
  while (true) {
    const ans = await prompt(`\n  Enter choice (1-${options.length + (extra ? 1 : 0)}): `)
    const n = parseInt(ans)
    if (n >= 1 && n <= options.length) return options[n - 1].value
    if (extra && n === options.length + 1) return "__extra__"
    console.log("  Invalid choice, try again.")
  }
}

// ── RETRY / ERROR HELPERS ─────────────────────────────────────────

const MAX_RETRIES   = 5
const RETRY_BASE_MS = 3000

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function getErrorString(err: any): string {
  const parts: string[] = []
  if (err?.message)           parts.push(err.message)
  if (err?.code)              parts.push(err.code)
  if (err?.cause?.message)    parts.push(err.cause.message)
  if (err?.cause?.code)       parts.push(err.cause.code)
  if (err?.response?.status)  parts.push(`HTTP ${err.response.status}`)
  if (parts.length === 0)     parts.push(String(err))
  return parts.join(" | ")
}

function isRetryable(err: any): boolean {
  const msg = getErrorString(err).toLowerCase()
  return (
    msg.includes("econnreset") || msg.includes("etimedout") ||
    msg.includes("enotfound") || msg.includes("econnrefused") ||
    msg.includes("socket hang up") || msg.includes("fetch failed") ||
    msg.includes("network") || msg.includes("und_err") ||
    msg.includes("epipe") || msg.includes("timeout") || msg.includes("abort") ||
    msg === "" || msg === "undefined" || msg === "null"
  )
}

async function withRetry<T>(label: string, fn: () => Promise<T>): Promise<T> {
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      return await fn()
    } catch (err: any) {
      const errStr = getErrorString(err)
      if (attempt < MAX_RETRIES && isRetryable(err)) {
        const delayMs = RETRY_BASE_MS * Math.pow(2, attempt - 1)
        console.warn(`  [RETRY] ${label}: ${errStr.slice(0, 120)} — retrying in ${delayMs / 1000}s (${attempt}/${MAX_RETRIES})`)
        await sleep(delayMs)
        continue
      }
      throw err
    }
  }
  throw new Error(`${label}: exhausted ${MAX_RETRIES} retries`)
}

// ── STRING UTILS ──────────────────────────────────────────────────

function stripHtml(html: string): string {
  return html
    .replace(/<[^>]*>/g, "")
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#039;/g, "'").replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ").trim()
}

function priceToPaisa(price: string): number {
  return Math.round(parseFloat(price || "0") * 100)
}

// ── MEDUSA API CLIENT ─────────────────────────────────────────────

async function medusaAdmin(method: string, apiPath: string, body?: any): Promise<any> {
  const url = `${MEDUSA_URL}/admin${apiPath}`
  if (VERBOSE) console.log(`  -> ${method} ${apiPath}`)

  return withRetry(`Medusa ${method} ${apiPath}`, async () => {
    const res = await fetch(url, {
      method,
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${authToken}`,
      },
      body: body ? JSON.stringify(body) : undefined,
    })
    if (!res.ok) {
      const errBody = await res.text()
      throw new Error(`Medusa API ${method} ${apiPath} failed (${res.status}): ${errBody.slice(0, 300)}`)
    }
    return res.json()
  })
}

// ── AUTHENTICATION ────────────────────────────────────────────────

async function authenticate(email: string, password: string): Promise<void> {
  console.log(`\n[AUTH] Authenticating with Medusa at ${MEDUSA_URL}...`)
  await withRetry("authenticate", async () => {
    const res = await fetch(`${MEDUSA_URL}/auth/user/emailpass`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    })
    if (!res.ok) {
      const body = await res.text()
      throw new Error(`Authentication failed (${res.status}): ${body}`)
    }
    const data = await res.json()
    const token = data.token
    if (!token) throw new Error(`No token in auth response: ${JSON.stringify(data)}`)
    authToken = token
  })
  console.log("  [OK] Authenticated successfully")
}

// ── R2 DIRECT CHECK ──────────────────────────────────────────────
//
//  Strategy (with R2 credentials available):
//  1. Derive the storage key Medusa uses: "uploads/<filename>"
//  2. HEAD that key directly against R2 (S3-compatible, Sig V4 signed)
//  3. If 200 → file exists → return R2_PUBLIC_URL/<key> immediately
//  4. If 404 → download from WooCommerce, upload via Medusa /admin/uploads
//
//  This means we NEVER re-upload an image that's already in R2,
//  even across fresh runs with no local cache.
// ────────────────────────────────────────────────────────────────

// R2 config — read once at startup, skip R2 direct checks if missing
const R2_ENDPOINT        = (process.env.R2_ENDPOINT        ?? "").replace(/\/$/, "")
const R2_PUBLIC_URL      = (process.env.R2_PUBLIC_URL      ?? "").replace(/\/$/, "")
const R2_BUCKET          = (process.env.R2_BUCKET          ?? "")
const R2_ACCESS_KEY_ID   = (process.env.R2_ACCESS_KEY_ID   ?? "")
const R2_SECRET_ACCESS_KEY = (process.env.R2_SECRET_ACCESS_KEY ?? "")

const R2_CONFIGURED = !!(R2_ENDPOINT && R2_BUCKET && R2_ACCESS_KEY_ID && R2_SECRET_ACCESS_KEY)

/** AWS Signature V4 for S3-compatible APIs (Cloudflare R2) — no SDK needed */
function signedR2Headers(
  method: string,
  key: string,         // e.g. "uploads/foo.jpg"
  contentType = ""
): Record<string, string> {
  const host    = new URL(R2_ENDPOINT).host
  const now     = new Date()
  const dateStr = now.toISOString().replace(/[:\-]|\.\d{3}/g, "").slice(0, 15) + "Z"  // YYYYMMDDTHHmmssZ
  const dateDay = dateStr.slice(0, 8)   // YYYYMMDD
  const region  = "auto"
  const service = "s3"

  const payloadHash = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855" // SHA256 of empty string

  const canonicalHeaders =
    `content-type:${contentType}\n` +
    `host:${host}\n` +
    `x-amz-content-sha256:${payloadHash}\n` +
    `x-amz-date:${dateStr}\n`
  const signedHeaders = "content-type;host;x-amz-content-sha256;x-amz-date"

  const canonicalRequest = [
    method,
    `/${R2_BUCKET}/${key}`,
    "",
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join("\n")

  const credentialScope = `${dateDay}/${region}/${service}/aws4_request`
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    dateStr,
    credentialScope,
    crypto.createHash("sha256").update(canonicalRequest).digest("hex"),
  ].join("\n")

  function hmac(key: Buffer | string, data: string): Buffer {
    return crypto.createHmac("sha256", key).update(data).digest()
  }

  const signingKey = hmac(
    hmac(hmac(hmac(`AWS4${R2_SECRET_ACCESS_KEY}`, dateDay), region), service),
    "aws4_request"
  )
  const signature = crypto.createHmac("sha256", signingKey).update(stringToSign).digest("hex")

  return {
    "Content-Type":          contentType,
    "Host":                  host,
    "x-amz-content-sha256": payloadHash,
    "x-amz-date":           dateStr,
    "Authorization":
      `AWS4-HMAC-SHA256 Credential=${R2_ACCESS_KEY_ID}/${credentialScope}, ` +
      `SignedHeaders=${signedHeaders}, Signature=${signature}`,
  }
}

/**
 * Check R2 directly for an existing object by filename.
 * Medusa's R2 plugin stores files under "uploads/<originalFilename>".
 * Returns the public URL if found, null if not found.
 */
async function checkR2ForImage(filename: string): Promise<string | null> {
  if (!R2_CONFIGURED) return null
  const key = `uploads/${filename}`
  const url = `${R2_ENDPOINT}/${R2_BUCKET}/${key}`
  try {
    const headers = signedR2Headers("HEAD", key)
    const res = await fetch(url, { method: "HEAD", headers })
    if (res.ok) {
      // File exists — build public URL
      const publicBase = R2_PUBLIC_URL || `${R2_ENDPOINT}/${R2_BUCKET}`
      return `${publicBase}/${key}`
    }
    if (res.status === 404) return null
    if (VERBOSE) console.log(`     [R2 HEAD] ${filename}: HTTP ${res.status}`)
    return null
  } catch (e: any) {
    if (VERBOSE) console.log(`     [R2 HEAD] ${filename}: ${e.message?.slice(0, 80)}`)
    return null
  }
}

// ── IMAGE CACHE (disk-persisted, dedup across runs) ───────────────

const CACHE_FILE = path.join(path.dirname(new URL(import.meta.url).pathname), "migration-images-cache.json")
const imageCache = new Map<string, string>()

function loadImageCache(): void {
  try {
    if (fs.existsSync(CACHE_FILE)) {
      const raw = JSON.parse(fs.readFileSync(CACHE_FILE, "utf-8"))
      for (const [k, v] of Object.entries(raw)) imageCache.set(k, v as string)
      console.log(`  [CACHE] Loaded ${imageCache.size} previously uploaded image URLs`)
    }
  } catch {
    console.warn("  [CACHE] Could not load image cache — starting fresh")
  }
}

function saveImageCache(): void {
  try {
    const obj: Record<string, string> = {}
    for (const [k, v] of imageCache) obj[k] = v
    fs.writeFileSync(CACHE_FILE, JSON.stringify(obj, null, 2))
  } catch { /* non-fatal */ }
}

/**
 * Resolve a WooCommerce image URL to an R2-hosted URL.
 *
 * Resolution order:
 *  1. Local run cache (migration-images-cache.json) — instant
 *  2. R2 direct HEAD check — skips download+upload if already there
 *  3. Download from WooCommerce + upload via Medusa /admin/uploads
 *  4. Fallback: return original WooCommerce URL
 */
async function resolveOrUploadImage(wooUrl: string): Promise<string> {
  // 1. Local cache hit
  if (imageCache.has(wooUrl)) return imageCache.get(wooUrl)!

  const filename = path.basename(new URL(wooUrl).pathname) || "image.jpg"

  // 2. Check R2 directly — avoid redundant upload if file already exists
  const existingR2Url = await checkR2ForImage(filename)
  if (existingR2Url) {
    if (VERBOSE) console.log(`     [R2 EXISTS] ${filename} → ${existingR2Url.slice(-60)}`)
    imageCache.set(wooUrl, existingR2Url)
    saveImageCache()
    return existingR2Url
  }

  // 3. Download from WooCommerce + upload via Medusa
  try {
    const imgRes = await withRetry(`Download ${filename.slice(0, 40)}`, async () => {
      const res = await fetch(wooUrl, { headers: { "User-Agent": "MedusaMigration/1.0" } })
      if (!res.ok) throw new Error(`Download failed (${res.status})`)
      return res
    })

    const contentType = imgRes.headers.get("content-type") || "image/jpeg"
    const buffer      = Buffer.from(await imgRes.arrayBuffer())
    const tmpDir      = fs.mkdtempSync(path.join(os.tmpdir(), "medusa-img-"))
    const tmpFile     = path.join(tmpDir, filename)
    fs.writeFileSync(tmpFile, buffer)

    try {
      const r2Url = await withRetry(`Upload ${filename.slice(0, 40)}`, async () => {
        const formData = new FormData()
        formData.append("files", new Blob([fs.readFileSync(tmpFile)], { type: contentType }), filename)

        const res = await fetch(`${MEDUSA_URL}/admin/uploads`, {
          method:  "POST",
          headers: { Authorization: `Bearer ${authToken}` },
          body:    formData,
        })
        if (!res.ok) {
          const errBody = await res.text()
          throw new Error(`Upload failed (${res.status}): ${errBody.slice(0, 200)}`)
        }
        const data = await res.json()
        const url  = data.files?.[0]?.url
        if (!url) throw new Error(`No URL in upload response: ${JSON.stringify(data).slice(0, 200)}`)
        return url
      })

      imageCache.set(wooUrl, r2Url)
      saveImageCache()
      if (VERBOSE) console.log(`     [R2 UPLOAD] → ${r2Url.slice(-60)}`)
      return r2Url
    } finally {
      try { fs.unlinkSync(tmpFile); fs.rmdirSync(tmpDir) } catch {}
    }
  } catch (err: any) {
    console.warn(`     [IMG WARN] ${filename.slice(0, 40)}: ${getErrorString(err).slice(0, 100)} — using original URL`)
    imageCache.set(wooUrl, wooUrl)
    return wooUrl
  }
}

// Set to true if the uploads endpoint is confirmed broken (avoids per-image spam)
let uploadsEndpointBroken = false

async function checkUploadsEndpoint(): Promise<void> {
  if (SKIP_IMAGES || DRY_RUN) return
  console.log("\n[IMAGES] Checking R2 + upload configuration...")

  if (R2_CONFIGURED) {
    console.log(`  [OK] R2 credentials present — direct existence checks enabled`)
    console.log(`       Bucket : ${R2_BUCKET}`)
    console.log(`       Public : ${R2_PUBLIC_URL || "(using endpoint URL)"}`)
  } else {
    console.log("  [WARN] R2 credentials not set — skipping pre-flight existence check.")
    console.log("         Add R2_ENDPOINT, R2_BUCKET, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY to .env")
    console.log("         to avoid re-uploading images that are already in R2.")
  }

  // Smoke-test Medusa's upload endpoint (still needed for writes)
  try {
    const tinyPng = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
      "base64"
    )
    const formData = new FormData()
    formData.append("files", new Blob([tinyPng], { type: "image/png" }), "_migration_test.png")
    const res = await fetch(`${MEDUSA_URL}/admin/uploads`, {
      method:  "POST",
      headers: { Authorization: `Bearer ${authToken}` },
      body:    formData,
    })
    if (!res.ok) {
      uploadsEndpointBroken = true
      console.log(`  [WARN] Medusa upload endpoint returned ${res.status} — image uploads disabled.`)
      console.log(`         Products will use original WooCommerce image URLs as fallback.`)
    } else {
      console.log("  [OK] Medusa upload endpoint is working — new images will be uploaded")
    }
  } catch (e: any) {
    uploadsEndpointBroken = true
    console.log(`  [WARN] Medusa upload endpoint unreachable: ${e.message?.slice(0, 100)}`)
    console.log(`         Falling back to WooCommerce image URLs.`)
  }
}

async function processImages(wooImages: Array<{ src: string }>): Promise<Array<{ url: string }>> {
  if (DRY_RUN || SKIP_IMAGES || uploadsEndpointBroken || wooImages.length === 0) {
    return wooImages.map((img) => ({ url: img.src }))
  }
  const results: Array<{ url: string }> = []
  for (const img of wooImages) {
    const url = await resolveOrUploadImage(img.src)
    results.push({ url })
  }
  return results
}

// ── SALES CHANNEL ─────────────────────────────────────────────────

async function selectOrCreateSalesChannel(): Promise<string | null> {
  if (DRY_RUN) {
    console.log("\n[SALES CHANNEL] Skipped in dry-run mode")
    return null
  }

  console.log("\n[SALES CHANNEL] Fetching from Medusa...")
  let channels: any[] = []

  try {
    const res = await medusaAdmin("GET", "/sales-channels?limit=100")
    channels = res.sales_channels || []
  } catch (e: any) {
    console.warn(`  Could not fetch sales channels: ${e.message}`)
  }

  if (channels.length === 0) {
    console.log("  No sales channels found.")
    const create = await prompt("  Create a new sales channel? (y/n): ")
    if (create.toLowerCase() !== "y") {
      console.log("  Skipping sales channel assignment.")
      return null
    }
    const name = await prompt("  Sales channel name: ")
    const desc = await prompt("  Description (optional, press Enter to skip): ")
    const result = await medusaAdmin("POST", "/sales-channels", {
      name,
      description: desc || `Sales channel for ${name}`,
      is_disabled: false,
    })
    const id = result.sales_channel?.id
    console.log(`  [OK] Created: "${name}" (${id})`)
    return id
  }

  const options = channels.map((c: any) => ({
    label: `${c.name} (${c.id})${c.is_disabled ? " [disabled]" : ""}`,
    value: c.id,
  }))

  const choice = await promptSelect(
    "Available sales channels:",
    options,
    "Create a new sales channel"
  )

  if (choice === "__extra__") {
    const name = await prompt("  New sales channel name: ")
    const desc = await prompt("  Description (optional, press Enter to skip): ")
    const result = await medusaAdmin("POST", "/sales-channels", {
      name,
      description: desc || `Sales channel for ${name}`,
      is_disabled: false,
    })
    const id = result.sales_channel?.id
    console.log(`  [OK] Created: "${name}" (${id})`)
    return id
  }

  const selected = channels.find((c: any) => c.id === choice)
  console.log(`  [OK] Using: "${selected?.name}" (${choice})`)
  return choice
}

async function assignToSalesChannel(channelId: string, productIds: string[]): Promise<void> {
  if (productIds.length === 0) return
  console.log(`\n[SALES CHANNEL] Assigning ${productIds.length} products...`)
  const BATCH = 20
  for (let i = 0; i < productIds.length; i += BATCH) {
    const batch = productIds.slice(i, i + BATCH)
    try {
      await medusaAdmin("POST", `/sales-channels/${channelId}/products`, { add: batch })
      process.stdout.write(".")
    } catch (e: any) {
      console.error(`\n  Batch ${Math.floor(i / BATCH) + 1} failed: ${e.message.slice(0, 150)}`)
    }
    await sleep(100)
  }
  console.log("\n  [OK] Assignment complete")
}

// ── REGION SETUP ──────────────────────────────────────────────────

async function ensureIndiaRegion(): Promise<void> {
  if (DRY_RUN) return
  try {
    const res = await medusaAdmin("GET", "/regions")
    const hasIndia = (res.regions || []).some(
      (r: any) => r.currency_code === "inr" || r.name?.toLowerCase().includes("india")
    )
    if (!hasIndia) {
      console.log("  Creating India/INR region...")
      await medusaAdmin("POST", "/regions", {
        name: "India", currency_code: "inr", countries: ["in"], payment_providers: [],
      })
      console.log("  [OK] India region created")
    } else {
      console.log("  [OK] India/INR region already exists")
    }
  } catch (e: any) {
    console.warn(`  Region check failed: ${e.message.slice(0, 100)}`)
  }
}

// ── CATEGORY SYNC ─────────────────────────────────────────────────

async function syncCategories(): Promise<Map<number, string>> {
  console.log("\n==========================================")
  console.log("  PHASE 1: CATEGORIES")
  console.log("==========================================\n")

  const all: WooCategory[] = []
  let page = 1
  while (true) {
    const { data } = await withRetry(`WooCommerce categories page ${page}`, () =>
      WOO_CLIENT.get("products/categories", { per_page: 100, page })
    ) as any
    if (data.length === 0) break
    all.push(...data)
    page++
  }
  console.log(`Fetched ${all.length} categories from WooCommerce`)

  const wcIdToMedusaId = new Map<number, string>()

  let existingCategories: any[] = []
  if (!DRY_RUN) {
    try {
      const res = await medusaAdmin("GET", "/product-categories?limit=500")
      existingCategories = res.product_categories || []
    } catch {
      console.warn("  Could not fetch existing categories")
    }
  }
  const existingByHandle = new Map(existingCategories.map((c: any) => [c.handle, c.id]))

  async function upsertCategory(cat: WooCategory, parentMedusaId?: string): Promise<void> {
    if (cat.slug === "uncategorized") {
      console.log(`  [SKIP] "Uncategorized"`)
      return
    }
    if (existingByHandle.has(cat.slug)) {
      const id = existingByHandle.get(cat.slug)!
      wcIdToMedusaId.set(cat.id, id)
      console.log(`  [EXISTS] "${cat.name}" -> ${id}`)
      return
    }
    const indent = parentMedusaId ? "    " : "  "
    console.log(`${indent}[CAT] "${cat.name}" (${cat.slug}) -- ${cat.count} products`)
    if (!DRY_RUN) {
      try {
        const result = await medusaAdmin("POST", "/product-categories", {
          name: cat.name,
          handle: cat.slug,
          description: cat.description || undefined,
          parent_category_id: parentMedusaId || undefined,
          is_active: true,
          is_internal: false,
        })
        const id = result.product_category.id
        wcIdToMedusaId.set(cat.id, id)
        console.log(`${indent}  [OK] Created -> ${id}`)
      } catch (e: any) {
        console.error(`${indent}  [FAIL] ${e.message}`)
      }
    } else {
      wcIdToMedusaId.set(cat.id, `dry_${cat.slug}`)
    }
  }

  const roots    = all.filter((c) => c.parent === 0).sort((a, b) => a.name.localeCompare(b.name))
  const children = all.filter((c) => c.parent !== 0).sort((a, b) => a.name.localeCompare(b.name))

  for (const cat of roots)    await upsertCategory(cat)
  for (const cat of children) await upsertCategory(cat, wcIdToMedusaId.get(cat.parent))

  console.log(`\n  ${wcIdToMedusaId.size} categories mapped`)
  return wcIdToMedusaId
}

// ── PATCH CATEGORIES ONTO EXISTING PRODUCTS ───────────────────────
//
//  Run after syncProducts() (or standalone with --patch-categories).
//  Fetches all Medusa products, matches by handle to WooCommerce,
//  then PATCHes the categories field — safe to run multiple times.
// ─────────────────────────────────────────────────────────────────

async function patchProductCategories(
  categoryMap: Map<number, string>
): Promise<void> {
  console.log("\n==========================================")
  console.log("  PHASE 3: PATCH CATEGORIES")
  console.log("==========================================\n")

  if (DRY_RUN) {
    console.log("  [DRY RUN] Skipping category patch")
    return
  }

  // 1. Fetch all WooCommerce products (handle → category IDs)
  console.log("  Fetching WooCommerce products for handle→category mapping...")
  const wooHandleToCategories = new Map<string, string[]>()
  let page = 1
  while (true) {
    const { data } = await withRetry(`WooCommerce products page ${page}`, () =>
      WOO_CLIENT.get("products", { status: "publish", per_page: 100, page })
    ) as any
    if (data.length === 0) break
    for (const p of data) {
      const catIds = (p.categories as Array<{ id: number }>)
        .map((c) => categoryMap.get(c.id))
        .filter((id): id is string => !!id)
      if (catIds.length > 0) wooHandleToCategories.set(p.slug as string, catIds)
    }
    page++
  }
  console.log(`  ${wooHandleToCategories.size} WooCommerce products have categories to apply`)

  // 2. Fetch all Medusa products (handle → id)
  console.log("  Fetching existing Medusa products...")
  const medusaHandleToId = new Map<string, string>()
  let offset = 0
  while (true) {
    const res = await medusaAdmin("GET", `/products?limit=100&offset=${offset}&fields=id,handle`)
    const batch: any[] = res.products || []
    if (batch.length === 0) break
    for (const p of batch) medusaHandleToId.set(p.handle, p.id)
    if (batch.length < 100) break
    offset += 100
  }
  console.log(`  ${medusaHandleToId.size} products found in Medusa`)

  // 3. PATCH categories onto each matched product
  let patched = 0, skipped = 0, failed = 0

  for (const [handle, catIds] of wooHandleToCategories) {
    const medusaId = medusaHandleToId.get(handle)
    if (!medusaId) {
      if (VERBOSE) console.log(`  [SKIP] "${handle}" — not found in Medusa`)
      skipped++
      continue
    }

    try {
      await medusaAdmin("POST", `/products/${medusaId}`, {
        categories: catIds.map((id) => ({ id })),
      })
      if (VERBOSE) console.log(`  [OK] "${handle}" → categories: [${catIds.join(", ")}]`)
      else process.stdout.write(".")
      patched++
    } catch (e: any) {
      console.error(`\n  [FAIL] "${handle}": ${e.message.slice(0, 150)}`)
      failed++
    }

    await sleep(80)
  }

  if (!VERBOSE) console.log("")
  console.log("\n  Category patch summary:")
  console.log(`    Patched:  ${patched}`)
  console.log(`    Skipped:  ${skipped} (not in Medusa)`)
  console.log(`    Failed:   ${failed}`)
}

// ── TAG SYNC ──────────────────────────────────────────────────────

async function ensureTags(names: Set<string>, tagMap: Map<string, string>): Promise<void> {
  if (DRY_RUN || names.size === 0) return
  if (tagMap.size === 0) {
    try {
      const res = await medusaAdmin("GET", "/product-tags?limit=500")
      const existing: any[] = res.product_tags || res.tags || []
      existing.forEach((t: any) => tagMap.set(t.value, t.id))
    } catch {}
  }
  for (const name of names) {
    if (tagMap.has(name)) continue
    try {
      const res = await medusaAdmin("POST", "/product-tags", { value: name })
      const id = res.product_tag?.id || res.tag?.id
      if (id) {
        tagMap.set(name, id)
        if (VERBOSE) console.log(`     [TAG] Created: "${name}" -> ${id}`)
      }
    } catch {}
  }
}

// ── PRODUCT SYNC ──────────────────────────────────────────────────

async function syncProducts(
  categoryMap: Map<number, string>,
  salesChannelId: string | null
): Promise<void> {
  console.log("\n==========================================")
  console.log("  PHASE 2: PRODUCTS")
  console.log("==========================================\n")

  const allProducts: WooProduct[] = []
  let page = 1
  process.stdout.write("Fetching products from WooCommerce")
  while (true) {
    const { data } = await withRetry(`WooCommerce products page ${page}`, () =>
      WOO_CLIENT.get("products", { status: "publish", per_page: 100, page })
    ) as any
    if (data.length === 0) break
    allProducts.push(...data)
    process.stdout.write(".")
    page++
  }
  console.log(`\n  ${allProducts.length} published products found`)

  if (allProducts.length === 0) {
    console.log("  Nothing to migrate.")
    return
  }

  // Fetch existing Medusa product handles (for dedup)
  const existingHandles = new Set<string>()
  if (!DRY_RUN && !FORCE) {
    try {
      let offset = 0
      while (true) {
        const res = await medusaAdmin("GET", `/products?limit=100&offset=${offset}&fields=handle`)
        const batch: any[] = res.products || []
        if (batch.length === 0) break
        batch.forEach((p: any) => existingHandles.add(p.handle))
        if (batch.length < 100) break
        offset += 100
      }
      if (existingHandles.size > 0) {
        console.log(`  ${existingHandles.size} products already in Medusa (will skip; use --force to override)`)
      }
    } catch {
      console.warn("  Could not check existing products -- will attempt to create all")
    }
  }

  const tagMap = new Map<string, string>()
  let created = 0, skipped = 0, failed = 0
  let imagesUploaded = 0, imagesReused = 0
  const createdProductIds: string[] = []

  for (let i = 0; i < allProducts.length; i++) {
    const product = allProducts[i]
    const prefix = `[${i + 1}/${allProducts.length}]`

    if (!FORCE && existingHandles.has(product.slug)) {
      if (VERBOSE) console.log(`  ${prefix} [SKIP] "${product.name}" -- already in Medusa`)
      else console.log(`  ${prefix} [SKIP] "${product.name}" -- already in Medusa`)
      skipped++
      continue
    }

    console.log(`\n  ${prefix} [PRODUCT] "${product.name}"`)

    // Fetch variations
    let variations: WooVariation[] = []
    if (product.variations.length > 0) {
      try {
        const { data } = await withRetry(`Fetch variations for ${product.slug}`, () =>
          WOO_CLIENT.get(`products/${product.id}/variations`, { per_page: 100 })
        ) as any
        variations = data
        console.log(`     Variations: ${variations.length}`)
      } catch (e: any) {
        console.warn(`     Could not fetch variations: ${e.message.slice(0, 80)}`)
      }
    }

    // Process images with R2 dedup
    const cacheBefore = imageCache.size
    const images = await processImages(product.images)
    const thisUploaded = imageCache.size - cacheBefore
    imagesUploaded += thisUploaded
    imagesReused   += images.length - thisUploaded
    console.log(`     Images: ${images.length} (${thisUploaded} uploaded, ${images.length - thisUploaded} reused/skipped)`)

    // Build options + variants
    const options: Array<{ title: string; values: string[] }> = []
    const variants: any[] = []

    if (variations.length > 0) {
      const optionMap = new Map<string, Set<string>>()
      for (const v of variations) {
        for (const attr of v.attributes) {
          if (!optionMap.has(attr.name)) optionMap.set(attr.name, new Set())
          optionMap.get(attr.name)!.add(attr.option)
        }
      }
      for (const [name, values] of optionMap) {
        options.push({ title: name, values: Array.from(values) })
      }
      for (const v of variations) {
        const variantOptions: Record<string, string> = {}
        for (const attr of v.attributes) variantOptions[attr.name] = attr.option
        const title = v.attributes.map((a) => a.option).join(" / ") || "Default"
        const price = v.price || v.regular_price || product.price || "0"
        const comparePrice =
          v.regular_price && v.sale_price && v.sale_price !== v.regular_price
            ? priceToPaisa(v.regular_price)
            : undefined

        variants.push({
          title,
          sku: v.sku || `${product.sku || product.slug}-${title.replace(/\s+/g, "-").toLowerCase()}`,
          options: variantOptions,
          prices: [{ amount: priceToPaisa(price), currency_code: "inr" }],
          // Note: inventory_quantity and compare_at_price are NOT accepted by
          // Medusa v2 POST /admin/products. Inventory is managed separately
          // via the Inventory Module after product creation.
          manage_inventory: true,
          weight: v.weight ? parseFloat(v.weight) * 1000 : undefined,
          length: v.dimensions?.length ? parseFloat(v.dimensions.length) : undefined,
          width:  v.dimensions?.width  ? parseFloat(v.dimensions.width)  : undefined,
          height: v.dimensions?.height ? parseFloat(v.dimensions.height) : undefined,
        })
      }
    } else {
      // Simple product -- single default variant
      options.push({ title: "Size", values: ["One Size"] })
      const price = product.price || product.regular_price || "0"
      const comparePrice =
        product.regular_price && product.sale_price && product.sale_price !== product.regular_price
          ? priceToPaisa(product.regular_price)
          : undefined

      variants.push({
        title: "One Size",
        sku: product.sku || product.slug,
        options: { Size: "One Size" },
        prices: [{ amount: priceToPaisa(price), currency_code: "inr" }],
        // Note: inventory_quantity and compare_at_price are NOT accepted by
        // Medusa v2 POST /admin/products.
        manage_inventory: true,
      })
    }

    // Categories
    const categoryIds = product.categories
      .map((c) => categoryMap.get(c.id))
      .filter((id): id is string => !!id)

    // Tags
    const tagNames = new Set(product.tags.map((t) => t.name))
    await ensureTags(tagNames, tagMap)
    const resolvedTagIds = Array.from(tagNames)
      .map((name) => tagMap.get(name))
      .filter((id): id is string => !!id)
      .map((id) => ({ id }))

    // Assemble payload
    const payload: any = {
      title:       product.name,
      handle:      product.slug,
      subtitle:    stripHtml(product.short_description).slice(0, 255) || undefined,
      description: stripHtml(product.description) || undefined,
      status:      "published",
      thumbnail:   images[0]?.url || undefined,
      images,
      options,
      variants,
      weight: product.weight            ? parseFloat(product.weight) * 1000            : undefined,
      length: product.dimensions?.length ? parseFloat(product.dimensions.length) : undefined,
      width:  product.dimensions?.width  ? parseFloat(product.dimensions.width)  : undefined,
      height: product.dimensions?.height ? parseFloat(product.dimensions.height) : undefined,
      categories: categoryIds.length > 0 ? categoryIds.map((id) => ({ id })) : undefined,
      tags:       resolvedTagIds.length > 0 ? resolvedTagIds                   : undefined,
    }

    if (DRY_RUN) {
      console.log(`     [DRY RUN] Would create: handle="${product.slug}", variants=${variants.length}, images=${images.length}`)
      if (VERBOSE) console.log(`     Payload: ${JSON.stringify(payload, null, 2)}`)
      created++
      continue
    }

    try {
      const result = await medusaAdmin("POST", "/products", payload)
      const id = result.product?.id
      console.log(`     [OK] Created -> ${id} (${variants.length} variants, ${images.length} images)`)
      if (id) createdProductIds.push(id)
      created++
    } catch (e: any) {
      console.error(`     [FAIL] ${e.message.slice(0, 250)}`)
      failed++
    }

    await sleep(200)
  }

  // Assign to sales channel
  if (!DRY_RUN && salesChannelId && createdProductIds.length > 0) {
    await assignToSalesChannel(salesChannelId, createdProductIds)
  }

  // Summary
  console.log("\n==========================================")
  console.log("  MIGRATION SUMMARY")
  console.log("==========================================")
  console.log(`  Created:         ${created}`)
  console.log(`  Skipped:         ${skipped}`)
  console.log(`  Failed:          ${failed}`)
  console.log(`  Total:           ${allProducts.length}`)
  if (!SKIP_IMAGES && !DRY_RUN) {
    console.log(`  Images uploaded: ${imagesUploaded}`)
    console.log(`  Images reused:   ${imagesReused}`)
  }
  if (salesChannelId && !DRY_RUN) {
    console.log(`  SC assigned:     ${createdProductIds.length} products`)
  }
}

// ── INTERACTIVE SETUP ─────────────────────────────────────────────

/** Prompt only when a value is missing from env; show what was loaded automatically. */
async function interactiveSetup() {
  console.log("\n[SETUP] Configuration")

  const e = process.env

  // Helper: return env value if present and non-empty, else prompt
  async function resolve(
    envKey: string,
    question: string,
    redact = false
  ): Promise<string> {
    const val = (e[envKey] ?? "").trim()
    if (val) {
      const display = redact ? "●".repeat(Math.min(val.length, 8)) : val
      console.log(`  ${envKey.padEnd(28)} = ${display}  ← from .env`)
      return val
    }
    return prompt(`  ${question}: `)
  }

  const allPresent =
    e.MEDUSA_BACKEND_URL?.trim() &&
    e.MEDUSA_ADMIN_EMAIL?.trim() &&
    e.MEDUSA_ADMIN_PASSWORD?.trim() &&
    e.WOOCOMMERCE_URL?.trim() &&
    e.WOOCOMMERCE_CONSUMER_KEY?.trim() &&
    e.WOOCOMMERCE_CONSUMER_SECRET?.trim()

  if (allPresent) {
    console.log("  All credentials loaded from .env — no prompts needed.\n")
    console.log(`  MEDUSA_BACKEND_URL           = ${e.MEDUSA_BACKEND_URL}`)
    console.log(`  MEDUSA_ADMIN_EMAIL           = ${e.MEDUSA_ADMIN_EMAIL}`)
    console.log(`  MEDUSA_ADMIN_PASSWORD        = ${"●".repeat(8)}`)
    console.log(`  WOOCOMMERCE_URL              = ${e.WOOCOMMERCE_URL}`)
    console.log(`  WOOCOMMERCE_CONSUMER_KEY     = ${e.WOOCOMMERCE_CONSUMER_KEY!.slice(0, 8)}…`)
    console.log(`  WOOCOMMERCE_CONSUMER_SECRET  = ${e.WOOCOMMERCE_CONSUMER_SECRET!.slice(0, 8)}…`)

    return {
      medusaUrl:      e.MEDUSA_BACKEND_URL!,
      email:          e.MEDUSA_ADMIN_EMAIL!,
      password:       e.MEDUSA_ADMIN_PASSWORD!,
      wooUrl:         e.WOOCOMMERCE_URL!,
      consumerKey:    e.WOOCOMMERCE_CONSUMER_KEY!,
      consumerSecret: e.WOOCOMMERCE_CONSUMER_SECRET!,
    }
  }

  console.log("  (Missing values will be prompted; others loaded from .env)\n")

  const medusaUrl      = await resolve("MEDUSA_BACKEND_URL",          "Medusa backend URL (e.g. https://api.yourdomain.com)")
  const email          = await resolve("MEDUSA_ADMIN_EMAIL",           "Medusa admin email")
  const password       = await resolve("MEDUSA_ADMIN_PASSWORD",        "Medusa admin password", true)
  const wooUrl         = await resolve("WOOCOMMERCE_URL",              "WooCommerce site URL (e.g. https://yourstore.com)")
  const consumerKey    = await resolve("WOOCOMMERCE_CONSUMER_KEY",     "WooCommerce consumer key (ck_...)")
  const consumerSecret = await resolve("WOOCOMMERCE_CONSUMER_SECRET",  "WooCommerce consumer secret (cs_...)")

  return { medusaUrl, email, password, wooUrl, consumerKey, consumerSecret }
}

// ── MAIN ──────────────────────────────────────────────────────────

async function main() {
  console.log("==========================================================")
  console.log("  WooCommerce -> Medusa v2   Migration")
  console.log("==========================================================")

  const flags: string[] = []
  if (DRY_RUN)          flags.push("DRY RUN")
  if (FORCE)            flags.push("FORCE (re-migrate existing)")
  if (SKIP_IMAGES)      flags.push("SKIP IMAGES")
  if (PATCH_CATEGORIES) flags.push("PATCH CATEGORIES ONLY")
  if (VERBOSE)          flags.push("VERBOSE")
  if (flags.length) console.log(`  Mode: ${flags.join(" | ")}`)

  const config = await interactiveSetup()

  MEDUSA_URL = config.medusaUrl.replace(/\/$/, "")

  // Load the image URL cache from disk (enables dedup across runs)
  loadImageCache()

  WOO_CLIENT = new WooCommerceRestApi({
    url: config.wooUrl,
    consumerKey: config.consumerKey,
    consumerSecret: config.consumerSecret,
    version: "wc/v3",
    timeout: 30000,
    axiosConfig: {
      timeout: 30000,
      headers: { "User-Agent": "MedusaMigration/1.0" },
    },
  })

  console.log(`\n  Source: ${config.wooUrl}`)
  console.log(`  Target: ${MEDUSA_URL}`)

  if (!DRY_RUN) {
    const confirm = await prompt("\n  This will write to your Medusa instance. Proceed? (y/n): ")
    if (confirm.toLowerCase() !== "y") {
      console.log("\n  Aborted. Run with --dry-run to preview.")
      process.exit(0)
    }
    await authenticate(config.email, config.password)
    console.log("\n[SETUP] Checking store configuration...")
    await ensureIndiaRegion()
  }

  // Preflight: test if /admin/uploads works (R2 configured in Medusa)
  if (!PATCH_CATEGORIES) await checkUploadsEndpoint()

  const salesChannelId = await selectOrCreateSalesChannel()
  const categoryMap    = await syncCategories()

  if (PATCH_CATEGORIES) {
    // Standalone mode: only patch categories onto existing products, no product sync
    await patchProductCategories(categoryMap)
  } else {
    await syncProducts(categoryMap, salesChannelId)
    // Also patch categories onto any products that were skipped (already existed)
    await patchProductCategories(categoryMap)
  }

  console.log("\n[DONE] Migration complete!\n")
}

main().catch((err) => {
  console.error("\n[FATAL]", err.message || err)
  if (VERBOSE) console.error(err.stack)
  process.exit(1)
})
