#!/usr/bin/env node
/**
 * Shipping Provider Audit & Migration Script
 * 
 * Audits the current shipping configuration in Medusa and helps
 * migrate from Manual fulfillment to Shiprocket.
 * 
 * Usage:
 *   node scripts/shipping-audit.mjs                    # Audit only (read-only)
 *   node scripts/shipping-audit.mjs --migrate          # Interactive migration
 * 
 * Environment:
 *   MEDUSA_URL       - Backend URL (default: https://testmed.psmhome.no)
 *   ADMIN_EMAIL      - Admin email for auth
 *   ADMIN_PASSWORD   - Admin password for auth
 */

const MEDUSA_URL = process.env.MEDUSA_URL || "https://testmed.psmhome.no"
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || "pratik@onezipp.com"
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "iBDDjcZvYj6*M8Q"

const MIGRATE = process.argv.includes("--migrate")

// Colors for terminal output
const C = {
  reset: "\x1b[0m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  cyan: "\x1b[36m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
}

async function main() {
  console.log(`\n${C.bold}${C.cyan}═══════════════════════════════════════════════════${C.reset}`)
  console.log(`${C.bold}  Shipping Provider Audit${MIGRATE ? " & Migration" : ""}${C.reset}`)
  console.log(`${C.dim}  ${MEDUSA_URL}${C.reset}`)
  console.log(`${C.cyan}═══════════════════════════════════════════════════${C.reset}\n`)

  // 1. Authenticate
  const token = await authenticate()
  if (!token) {
    console.error(`${C.red}✗ Authentication failed${C.reset}`)
    process.exit(1)
  }
  console.log(`${C.green}✓ Authenticated as ${ADMIN_EMAIL}${C.reset}\n`)

  // 2. Fetch stock locations
  console.log(`${C.bold}── Stock Locations ──${C.reset}`)
  const locations = await apiGet("/admin/stock-locations", token)
  if (!locations?.stock_locations?.length) {
    console.log(`${C.yellow}  No stock locations found${C.reset}`)
  } else {
    for (const loc of locations.stock_locations) {
      console.log(`  📍 ${C.bold}${loc.name}${C.reset} (${loc.id})`)
      
      // Fetch fulfillment sets for this location
      const locDetail = await apiGet(`/admin/stock-locations/${loc.id}?fields=*fulfillment_sets,*fulfillment_sets.service_zones,*fulfillment_sets.service_zones.shipping_options`, token)
      const sets = locDetail?.stock_location?.fulfillment_sets || []
      if (sets.length) {
        for (const set of sets) {
          console.log(`     └─ Fulfillment Set: ${set.name || set.id} (type: ${set.type})`)
          for (const zone of set.service_zones || []) {
            console.log(`        └─ Zone: ${zone.name || zone.id}`)
          }
        }
      } else {
        console.log(`     └─ ${C.yellow}No fulfillment sets${C.reset}`)
      }
    }
  }

  // 3. Fetch fulfillment providers
  console.log(`\n${C.bold}── Fulfillment Providers ──${C.reset}`)
  const providers = await apiGet("/admin/fulfillment-providers", token)
  if (!providers?.fulfillment_providers?.length) {
    console.log(`  ${C.yellow}No fulfillment providers registered${C.reset}`)
  } else {
    for (const p of providers.fulfillment_providers) {
      const isShiprocket = p.id?.includes("shiprocket")
      const icon = isShiprocket ? "🚀" : "📦"
      console.log(`  ${icon} ${C.bold}${p.id}${C.reset}${isShiprocket ? ` ${C.green}← Shiprocket${C.reset}` : ""}`)
    }
  }

  // 4. Fetch shipping options
  console.log(`\n${C.bold}── Shipping Options ──${C.reset}`)
  const shippingOpts = await apiGet("/admin/shipping-options?limit=50", token)
  if (!shippingOpts?.shipping_options?.length) {
    console.log(`  ${C.yellow}No shipping options configured${C.reset}`)
  } else {
    const manualOptions = []
    const shiprocketOptions = []
    
    for (const opt of shippingOpts.shipping_options) {
      const isManual = !opt.provider_id?.includes("shiprocket")
      const providerLabel = opt.provider_id || "unknown"
      
      if (isManual) {
        manualOptions.push(opt)
        console.log(`  ${C.yellow}⚠ ${opt.name}${C.reset} → provider: ${C.red}${providerLabel}${C.reset} | price: ${opt.amount || "calculated"} | id: ${opt.id}`)
      } else {
        shiprocketOptions.push(opt)
        console.log(`  ${C.green}✓ ${opt.name}${C.reset} → provider: ${C.green}${providerLabel}${C.reset} | price: ${opt.amount || "calculated"} | id: ${opt.id}`)
      }
    }

    console.log(`\n  ${C.bold}Summary:${C.reset}`)
    console.log(`    Manual options:    ${manualOptions.length}${manualOptions.length ? ` ${C.yellow}← should migrate${C.reset}` : ""}`)
    console.log(`    Shiprocket options: ${shiprocketOptions.length}`)
  }

  // 5. Fetch regions and their shipping options
  console.log(`\n${C.bold}── Regions ──${C.reset}`)
  const regions = await apiGet("/admin/regions?fields=*shipping_options,name,id,currency_code", token)
  if (regions?.regions?.length) {
    for (const region of regions.regions) {
      console.log(`  🌍 ${C.bold}${region.name}${C.reset} (${region.currency_code?.toUpperCase()}) → id: ${region.id}`)
    }
  }

  // 6. Fetch shipping profiles
  console.log(`\n${C.bold}── Shipping Profiles ──${C.reset}`)
  const profiles = await apiGet("/admin/shipping-profiles", token)
  if (profiles?.shipping_profiles?.length) {
    for (const profile of profiles.shipping_profiles) {
      console.log(`  📋 ${C.bold}${profile.name}${C.reset} (${profile.type}) → id: ${profile.id}`)
    }
  }

  // 7. Migration suggestions
  if (!MIGRATE) {
    console.log(`\n${C.cyan}═══════════════════════════════════════════════════${C.reset}`)
    console.log(`${C.bold}  To migrate shipping options to Shiprocket, run:${C.reset}`)
    console.log(`  ${C.dim}node scripts/shipping-audit.mjs --migrate${C.reset}`)
    console.log(`${C.cyan}═══════════════════════════════════════════════════${C.reset}\n`)
  } else {
    await runMigration(token, providers, shippingOpts, locations)
  }
}

async function runMigration(token, providers, shippingOpts, locations) {
  console.log(`\n${C.bold}${C.cyan}── Migration Mode ──${C.reset}\n`)

  // Check if Shiprocket provider exists
  const shiprocketProvider = providers?.fulfillment_providers?.find(
    (p) => p.id?.includes("shiprocket")
  )

  if (!shiprocketProvider) {
    console.log(`${C.red}✗ Shiprocket fulfillment provider not found!${C.reset}`)
    console.log(`  Make sure SHIPROCKET_EMAIL is set in Coolify env vars and the app has been redeployed.`)
    return
  }

  console.log(`${C.green}✓ Shiprocket provider found: ${shiprocketProvider.id}${C.reset}\n`)

  // Find manual shipping options
  const manualOptions = shippingOpts?.shipping_options?.filter(
    (opt) => !opt.provider_id?.includes("shiprocket")
  ) || []

  if (manualOptions.length === 0) {
    console.log(`${C.green}✓ No manual shipping options to migrate — all good!${C.reset}`)
    return
  }

  console.log(`Found ${manualOptions.length} manual shipping option(s) to review:\n`)

  for (const opt of manualOptions) {
    console.log(`  ${C.yellow}${opt.name}${C.reset}`)
    console.log(`    Provider: ${opt.provider_id}`)
    console.log(`    Price: ${opt.amount || "N/A"}`)
    console.log(`    ID: ${opt.id}`)

    // Note: Medusa v2 API doesn't support updating the provider_id of an existing
    // shipping option. We need to create a new one with Shiprocket and optionally
    // disable/delete the old one.
    console.log(`    ${C.dim}→ Will create a Shiprocket replacement${C.reset}`)
  }

  // Interactive confirmation
  const readline = await import("readline")
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
  
  const answer = await new Promise((resolve) => {
    rl.question(`\n${C.bold}Create Shiprocket shipping options to replace manual ones? (y/n): ${C.reset}`, resolve)
  })

  if (answer.toLowerCase() !== "y") {
    console.log("Migration cancelled.")
    rl.close()
    return
  }

  // Find service zone to attach shipping options to
  const locationDetail = await apiGet(
    `/admin/stock-locations/${locations.stock_locations[0].id}?fields=*fulfillment_sets,*fulfillment_sets.service_zones`,
    token
  )
  const fulfillmentSets = locationDetail?.stock_location?.fulfillment_sets || []
  let serviceZoneId = null
  
  for (const set of fulfillmentSets) {
    for (const zone of set.service_zones || []) {
      serviceZoneId = zone.id
      break
    }
    if (serviceZoneId) break
  }

  if (!serviceZoneId) {
    console.log(`${C.red}✗ No service zone found. Create a fulfillment set + service zone first in admin.${C.reset}`)
    rl.close()
    return
  }

  // Find Shiprocket shipping profile
  const shiprocketProfile = await apiGet("/admin/shipping-profiles", token)
  const profileId = shiprocketProfile?.shipping_profiles?.find(
    p => p.name?.toLowerCase().includes("shiprocket")
  )?.id || shiprocketProfile?.shipping_profiles?.[0]?.id

  // Create Shiprocket shipping options
  for (const opt of manualOptions) {
    const newName = opt.name.replace(/manual/i, "").trim() || opt.name
    console.log(`\n  Creating: ${C.cyan}${newName} (Shiprocket)${C.reset}...`)

    try {
      // Clean rules — strip internal fields that the create API rejects
      const cleanRules = (opt.rules || []).map(r => ({
        attribute: r.attribute,
        operator: r.operator,
        value: r.value,
      }))

      const result = await apiPost("/admin/shipping-options", {
        name: `${newName} (Shiprocket)`,
        service_zone_id: serviceZoneId,
        shipping_profile_id: profileId,
        provider_id: shiprocketProvider.id,
        price_type: "flat",
        type: {
          label: opt.type?.label || "Delivery_5-7",
          description: opt.type?.description || "Standard delivery via Shiprocket",
          code: opt.type?.code || "shiprocket-standard",
        },
        data: {},
        rules: cleanRules,
        prices: [
          {
            currency_code: "inr",
            amount: opt.amount || 0,
          },
        ],
      }, token)

      if (result?.shipping_option) {
        console.log(`  ${C.green}✓ Created: ${result.shipping_option.name} (${result.shipping_option.id})${C.reset}`)
        
        // Optionally disable the old manual option
        const disableAnswer = await new Promise((resolve) => {
          rl.question(`  ${C.yellow}Disable old "${opt.name}"? (y/n): ${C.reset}`, resolve)
        })
        
        if (disableAnswer.toLowerCase() === "y") {
          try {
            await apiPost(`/admin/shipping-options/${opt.id}`, {
              admin_only: true, // Hide from storefront
            }, token)
            console.log(`  ${C.green}✓ Old option hidden from storefront${C.reset}`)
          } catch (e) {
            console.log(`  ${C.yellow}⚠ Could not disable old option: ${e.message}${C.reset}`)
          }
        }
      } else {
        console.log(`  ${C.red}✗ Failed to create: ${JSON.stringify(result)}${C.reset}`)
      }
    } catch (err) {
      console.log(`  ${C.red}✗ Error: ${err.message}${C.reset}`)
    }
  }

  rl.close()
  console.log(`\n${C.green}✓ Migration complete!${C.reset}`)
  console.log(`${C.dim}  Run this script again without --migrate to verify.${C.reset}\n`)
}

// ──── API Helpers ────

async function authenticate() {
  try {
    // Medusa v2 admin auth: POST /auth/user/emailpass
    const authRes = await fetch(`${MEDUSA_URL}/auth/user/emailpass`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD }),
    })
    
    if (!authRes.ok) {
      const text = await authRes.text()
      console.error(`Auth failed (${authRes.status}): ${text}`)
      return null
    }

    const data = await authRes.json()
    return data.token
  } catch (err) {
    console.error(`Auth error: ${err.message}`)
    return null
  }
}

async function apiGet(path, token) {
  try {
    const res = await fetch(`${MEDUSA_URL}${path}`, {
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
    })
    if (!res.ok) {
      const text = await res.text()
      console.error(`${C.dim}  API GET ${path} → ${res.status}: ${text.substring(0, 200)}${C.reset}`)
      return null
    }
    return await res.json()
  } catch (err) {
    console.error(`${C.dim}  API GET ${path} error: ${err.message}${C.reset}`)
    return null
  }
}

async function apiPost(path, body, token) {
  const res = await fetch(`${MEDUSA_URL}${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`${res.status}: ${text.substring(0, 300)}`)
  }
  return await res.json()
}

main().catch((err) => {
  console.error(`\n${C.red}Fatal error: ${err.message}${C.reset}`)
  process.exit(1)
})
