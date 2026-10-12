#!/usr/bin/env node
/**
 * Set MedusaJS order display_id sequence to start from 3000
 *
 * MedusaJS v2 uses a PostgreSQL sequence for order.display_id.
 * This script sets it to 3000 so the next order gets display_id 3000.
 *
 * Run this ONCE on the production database before going live on chamkileystore.in
 *
 * Usage:
 *   DATABASE_URL="postgres://..." node scripts/set-order-sequence.mjs
 *
 * Or run the SQL directly:
 *   SELECT setval('order_display_id_seq', 2999, true);
 */

const DATABASE_URL = process.env.DATABASE_URL

if (!DATABASE_URL) {
  console.error("❌ DATABASE_URL env var required")
  console.log("")
  console.log("Usage:")
  console.log('  DATABASE_URL="postgres://user:pass@host:5432/db" node scripts/set-order-sequence.mjs')
  console.log("")
  console.log("Or run this SQL directly on your PostgreSQL database:")
  console.log("  SELECT setval('order_display_id_seq', 2999, true);")
  process.exit(1)
}

async function main() {
  // Dynamic import for pg (may not be installed locally)
  let pg
  try {
    pg = await import("pg")
  } catch {
    console.error("❌ 'pg' package not found. Run: pnpm add pg")
    console.log("")
    console.log("Alternatively, run this SQL manually on your production database:")
    console.log("")
    console.log("  -- Check current sequence value")
    console.log("  SELECT last_value FROM order_display_id_seq;")
    console.log("")
    console.log("  -- Set sequence to start from 3000")
    console.log("  SELECT setval('order_display_id_seq', 2999, true);")
    console.log("")
    console.log("  -- Verify")
    console.log("  SELECT nextval('order_display_id_seq');  -- Should return 3000")
    process.exit(1)
  }

  const client = new pg.default.Client({ connectionString: DATABASE_URL })
  await client.connect()

  try {
    // Find the actual sequence name
    const seqResult = await client.query(`
      SELECT pg_get_serial_sequence('order', 'display_id') AS seq_name
    `)

    let seqName = seqResult.rows[0]?.seq_name
    if (!seqName) {
      // Try common sequence names
      const fallbacks = ['order_display_id_seq', 'public.order_display_id_seq']
      for (const name of fallbacks) {
        try {
          await client.query(`SELECT last_value FROM ${name}`)
          seqName = name
          break
        } catch { /* continue */ }
      }
    }

    if (!seqName) {
      console.error("❌ Could not find order display_id sequence")
      console.log("Run this query to find it:")
      console.log("  SELECT * FROM information_schema.sequences WHERE sequence_name LIKE '%order%display%';")
      return
    }

    // Check current value
    const currentResult = await client.query(`SELECT last_value FROM ${seqName}`)
    console.log(`Current sequence value: ${currentResult.rows[0].last_value}`)

    if (Number(currentResult.rows[0].last_value) >= 2999) {
      console.log("✅ Sequence already at 3000+. No change needed.")
      return
    }

    // Set to 2999 (next call to nextval will return 3000)
    await client.query(`SELECT setval('${seqName}', 2999, true)`)

    // Verify
    const verifyResult = await client.query(`SELECT last_value FROM ${seqName}`)
    console.log(`✅ Sequence set to: ${verifyResult.rows[0].last_value}`)
    console.log("Next order will get display_id: 3000")
  } finally {
    await client.end()
  }
}

main().catch(e => { console.error("❌", e.message); process.exit(1) })
