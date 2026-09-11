#!/usr/bin/env node
/**
 * setup-gst.mjs — Configure Indian GST tax structure in MedusaJS v2
 *
 * Sets up:
 *   1. Tax-inclusive pricing + automatic taxes on the India region
 *   2. Karnataka province sub-region with CGST 2.5% + SGST 2.5% (combinable)
 *   3. Parent IN region keeps IGST 5% as default (inter-state)
 *
 * Usage:
 *   MEDUSA_URL=https://testmed.psmhome.no \
 *   ADMIN_EMAIL=pratik@onezipp.com \
 *   ADMIN_PASSWORD='iBDDjcZvYj6*M8Q' \
 *   node scripts/setup-gst.mjs
 */

const MEDUSA_URL = process.env.MEDUSA_URL || "https://testmed.psmhome.no"
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || "pratik@onezipp.com"
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "iBDDjcZvYj6*M8Q"

// Known IDs from current config
const INDIA_REGION_ID = "reg_01M1A2Y6ESG7AT7V602M2FMQBP"
const INDIA_TAX_REGION_ID = "txreg_01M1NWPCCD8N90SWGDX2Q83149"

async function getToken() {
  const res = await fetch(`${MEDUSA_URL}/auth/user/emailpass`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD }),
  })
  const data = await res.json()
  if (!data.token) throw new Error(`Auth failed: ${JSON.stringify(data)}`)
  return data.token
}

async function api(method, path, body, token) {
  const opts = {
    method,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
  }
  if (body) opts.body = JSON.stringify(body)
  const res = await fetch(`${MEDUSA_URL}${path}`, opts)
  const text = await res.text()
  try {
    return { status: res.status, data: JSON.parse(text) }
  } catch {
    return { status: res.status, data: text }
  }
}

async function main() {
  console.log("🔐 Authenticating...")
  const token = await getToken()
  console.log("✅ Authenticated\n")

  // ── Step 1: Enable tax-inclusive + automatic taxes on India region ──
  console.log("📦 Step 1: Enable tax-inclusive pricing on India region...")
  const regionRes = await api("POST", `/admin/regions/${INDIA_REGION_ID}`, {
    is_tax_inclusive: true,
    automatic_taxes: true,
  }, token)

  if (regionRes.status === 200) {
    const r = regionRes.data?.region
    console.log(`   ✅ Region "${r?.name}" updated:`)
    console.log(`      is_tax_inclusive: ${r?.is_tax_inclusive}`)
    console.log(`      automatic_taxes: ${r?.automatic_taxes}`)
  } else {
    console.log(`   ⚠️  Region update response (${regionRes.status}):`, JSON.stringify(regionRes.data).slice(0, 200))
  }

  // ── Step 2: Update parent IN tax rate to be explicitly IGST ──
  console.log("\n📋 Step 2: Verify parent IGST 5% rate on IN tax region...")
  const ratesRes = await api("GET", `/admin/tax-rates?tax_region_id=${INDIA_TAX_REGION_ID}&limit=10`, null, token)
  const existingRates = ratesRes.data?.tax_rates || []
  console.log(`   Found ${existingRates.length} existing rate(s):`)
  for (const r of existingRates) {
    console.log(`     - ${r.name} (${r.code}): ${r.rate}% | default: ${r.is_default} | combinable: ${r.is_combinable}`)
  }

  // Ensure the existing rate is named IGST and is the default
  const igstRate = existingRates.find(r => r.is_default)
  if (igstRate && (igstRate.name !== "IGST" || igstRate.code !== "IGST")) {
    console.log(`   Renaming "${igstRate.name}" → "IGST"...`)
    await api("POST", `/admin/tax-rates/${igstRate.id}`, {
      name: "IGST",
      code: "IGST",
      rate: 5,
    }, token)
    console.log("   ✅ Renamed to IGST")
  } else if (igstRate) {
    console.log("   ✅ IGST rate already correct")
  }

  // ── Step 3: Create Karnataka province sub-region ──
  console.log("\n🗺️  Step 3: Create Karnataka (IN-KA) province sub-region...")

  // Check if Karnataka sub-region already exists
  const subRegionsRes = await api("GET", `/admin/tax-regions?parent_id=${INDIA_TAX_REGION_ID}&limit=50`, null, token)
  const existingSubRegions = subRegionsRes.data?.tax_regions || []
  const karnatakaSub = existingSubRegions.find(r => r.province_code === "ka" || r.province_code === "in-ka" || r.province_code === "KA")

  let kaTaxRegionId
  if (karnatakaSub) {
    console.log(`   ✅ Karnataka sub-region already exists: ${karnatakaSub.id}`)
    kaTaxRegionId = karnatakaSub.id
  } else {
    // Create the sub-region
    const createSubRes = await api("POST", "/admin/tax-regions", {
      country_code: "in",
      province_code: "KA",
      parent_id: INDIA_TAX_REGION_ID,
    }, token)

    if (createSubRes.status === 200 || createSubRes.status === 201) {
      kaTaxRegionId = createSubRes.data?.tax_region?.id
      console.log(`   ✅ Created Karnataka sub-region: ${kaTaxRegionId}`)
    } else {
      console.log(`   ⚠️  Create sub-region response (${createSubRes.status}):`, JSON.stringify(createSubRes.data).slice(0, 300))
      // Try lowercase
      const createSubRes2 = await api("POST", "/admin/tax-regions", {
        country_code: "in",
        province_code: "ka",
        parent_id: INDIA_TAX_REGION_ID,
      }, token)
      if (createSubRes2.status === 200 || createSubRes2.status === 201) {
        kaTaxRegionId = createSubRes2.data?.tax_region?.id
        console.log(`   ✅ Created Karnataka sub-region (lowercase): ${kaTaxRegionId}`)
      } else {
        console.error("   ❌ Failed to create Karnataka sub-region:", JSON.stringify(createSubRes2.data).slice(0, 300))
        return
      }
    }
  }

  // ── Step 4: Create CGST + SGST rates on Karnataka sub-region ──
  console.log("\n💰 Step 4: Set up CGST 2.5% + SGST 2.5% on Karnataka...")

  // Check existing rates on Karnataka sub-region
  const kaRatesRes = await api("GET", `/admin/tax-rates?tax_region_id=${kaTaxRegionId}&limit=10`, null, token)
  const kaExistingRates = kaRatesRes.data?.tax_rates || []

  if (kaExistingRates.length > 0) {
    console.log(`   Found ${kaExistingRates.length} existing rate(s) on Karnataka:`)
    for (const r of kaExistingRates) {
      console.log(`     - ${r.name} (${r.code}): ${r.rate}% | combinable: ${r.is_combinable}`)
    }

    const hasCgst = kaExistingRates.some(r => r.code === "CGST")
    const hasSgst = kaExistingRates.some(r => r.code === "SGST")

    if (hasCgst && hasSgst) {
      console.log("   ✅ CGST + SGST rates already exist")
    } else {
      console.log("   ⚠️  Missing CGST/SGST rates, will create...")
    }
  }

  // Create CGST if missing
  const hasCgst = kaExistingRates.some(r => r.code === "CGST")
  if (!hasCgst) {
    const cgstRes = await api("POST", "/admin/tax-rates", {
      name: "CGST",
      code: "CGST",
      rate: 2.5,
      tax_region_id: kaTaxRegionId,
      is_default: true,
      is_combinable: true,
    }, token)
    if (cgstRes.status === 200 || cgstRes.status === 201) {
      console.log(`   ✅ Created CGST 2.5% (combinable): ${cgstRes.data?.tax_rate?.id}`)
    } else {
      console.log(`   ⚠️  CGST create response (${cgstRes.status}):`, JSON.stringify(cgstRes.data).slice(0, 200))
    }
  }

  // Create SGST if missing
  const hasSgst = kaExistingRates.some(r => r.code === "SGST")
  if (!hasSgst) {
    const sgstRes = await api("POST", "/admin/tax-rates", {
      name: "SGST",
      code: "SGST",
      rate: 2.5,
      tax_region_id: kaTaxRegionId,
      is_default: false,
      is_combinable: true,
    }, token)
    if (sgstRes.status === 200 || sgstRes.status === 201) {
      console.log(`   ✅ Created SGST 2.5% (combinable): ${sgstRes.data?.tax_rate?.id}`)
    } else {
      console.log(`   ⚠️  SGST create response (${sgstRes.status}):`, JSON.stringify(sgstRes.data).slice(0, 200))
    }
  }

  // ── Summary ──
  console.log("\n" + "═".repeat(60))
  console.log("GST CONFIGURATION SUMMARY")
  console.log("═".repeat(60))
  console.log(`Region: IND (${INDIA_REGION_ID})`)
  console.log(`  → is_tax_inclusive: true`)
  console.log(`  → automatic_taxes: true`)
  console.log("")
  console.log(`Tax Structure:`)
  console.log(`  IN (country) — Default: IGST 5%`)
  console.log(`  └── IN-KA (Karnataka) — CGST 2.5% + SGST 2.5% (combinable)`)
  console.log("")
  console.log(`Seller: Kalakavya Ecommerce LLP, Bengaluru 560064, Karnataka`)
  console.log(`GSTN: 29ABCFK6093Q1ZG`)
  console.log("═".repeat(60))
}

main().catch(console.error)
