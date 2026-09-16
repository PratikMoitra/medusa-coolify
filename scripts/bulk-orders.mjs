#!/usr/bin/env node
/**
 * Bulk Order Script for Medusa + Razorpay Test Mode
 * 
 * Places N orders through the Medusa Store API.
 * 
 * Two modes:
 *   1. API-only (default): Creates carts, adds items, sets addresses, 
 *      initializes payment, then completes the cart. Razorpay test mode
 *      may auto-authorize depending on settings.
 *   2. Browser mode (--browser): Opens the storefront checkout in a browser
 *      for each order to complete Razorpay payment interactively.
 * 
 * Razorpay Test Cards:
 *   - Success: 4111 1111 1111 1111 (any CVV, any future expiry)
 *   - Failure: Use any random card number
 * 
 * Usage:
 *   node scripts/bulk-orders.mjs [count]
 *   node scripts/bulk-orders.mjs 10
 * 
 * Environment (set via env or edit below):
 *   MEDUSA_URL          - Backend URL
 *   PUBLISHABLE_KEY     - Medusa publishable API key
 *   RAZORPAY_KEY_ID     - Razorpay test key ID
 *   RAZORPAY_KEY_SECRET - Razorpay test secret
 */

const MEDUSA_URL = process.env.MEDUSA_URL || "https://testmed.psmhome.no"
const PUBLISHABLE_KEY = process.env.PUBLISHABLE_KEY || "pk_05c172563f4766d8160ce4211e9795f21d688bd3586e8d77cea54423fab3ca57"
const RAZORPAY_KEY_ID = process.env.RAZORPAY_KEY_ID || "rzp_test_TXVo7CWqQZKamc"
const RAZORPAY_KEY_SECRET = process.env.RAZORPAY_KEY_SECRET || "z1C28CEuzATbZ1rmYDFdHxke"
const REGION_ID = process.env.REGION_ID || "reg_01M1A2Y6ESG7AT7V602M2FMQBP" // IND region

// Variant IDs to randomly pick from
const VARIANT_IDS = [
  "variant_01M1GVBEX47YQA5MGJ51B78CWS", // #Kappi Holic Black/XXL
  "variant_01M1GVBEX5PJF5AP7XT19CJ2TE", // #Kappi Holic Black/M
  "variant_01M1GVBEX4QWNXXTVTT2SA1MPQ", // #Kappi Holic White/M
  "variant_01M1GVBEX47ACN5CMBM30J74C4", // #Kappi Holic White/S
  "variant_01M1GVBEX5TK0S4PP4A05CXFCH", // #Kappi Holic Black/XL
  "variant_01M1GVBEX57XHR49AQKGF3FVVE", // #Kappi Holic Black/L
]

// Test customer details (randomized per order)
const FIRST_NAMES = ["Aarav", "Priya", "Rahul", "Sneha", "Vikram", "Ananya", "Rohit", "Meera", "Arjun", "Divya", "Karan", "Neha"]
const LAST_NAMES = ["Sharma", "Patel", "Kumar", "Singh", "Gupta", "Reddy", "Joshi", "Iyer", "Nair", "Das", "Chopra", "Verma"]
const CITIES = ["Mumbai", "Delhi", "Bangalore", "Chennai", "Hyderabad", "Pune", "Kolkata", "Ahmedabad", "Jaipur", "Lucknow"]
const ADDRESSES = ["123 MG Road", "45 Brigade Road", "78 Park Street", "12 Anna Nagar", "89 Jubilee Hills", "34 Koregaon Park"]

const ORDER_COUNT = parseInt(process.argv[2] || "10", 10)

// ─── Helpers ────────────────────────────────────────────────────
function pick(arr) { return arr[Math.floor(Math.random() * arr.length)] }
function randPhone() { return `+91${Math.floor(7000000000 + Math.random() * 2999999999)}` }
function randEmail(first, last, i) { return `test.${first.toLowerCase()}.${last.toLowerCase()}${i}@testorder.chamkileystore.in` }

async function api(path, method = "GET", body = null) {
  const headers = {
    "Content-Type": "application/json",
    "x-publishable-api-key": PUBLISHABLE_KEY,
  }
  const opts = { method, headers }
  if (body) opts.body = JSON.stringify(body)

  const res = await fetch(`${MEDUSA_URL}${path}`, opts)
  const text = await res.text()
  try {
    return { ok: res.ok, status: res.status, data: JSON.parse(text) }
  } catch {
    return { ok: res.ok, status: res.status, data: text }
  }
}

async function razorpayApi(path, method = "GET", body = null) {
  const auth = Buffer.from(`${RAZORPAY_KEY_ID}:${RAZORPAY_KEY_SECRET}`).toString("base64")
  const headers = {
    "Content-Type": "application/json",
    "Authorization": `Basic ${auth}`,
  }
  const opts = { method, headers }
  if (body) opts.body = JSON.stringify(body)

  const res = await fetch(`https://api.razorpay.com/v1${path}`, opts)
  const data = await res.json()
  return { ok: res.ok, status: res.status, data }
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)) }

// ─── Order Flow ─────────────────────────────────────────────────
async function placeOrder(orderNum) {
  const firstName = pick(FIRST_NAMES)
  const lastName = pick(LAST_NAMES)
  const email = randEmail(firstName, lastName, orderNum)
  const phone = randPhone()
  const city = pick(CITIES)
  const variantId = pick(VARIANT_IDS)
  const qty = Math.floor(Math.random() * 3) + 1

  console.log(`\n── Order #${orderNum} ──────────────────────`)
  console.log(`  Customer: ${firstName} ${lastName} <${email}>`)
  console.log(`  Variant:  ${variantId} × ${qty}`)

  // Step 1: Create cart
  const cart = await api("/store/carts", "POST", { region_id: REGION_ID })
  if (!cart.ok) throw new Error(`Create cart failed: ${JSON.stringify(cart.data)}`)
  const cartId = cart.data.cart.id
  console.log(`  ✓ Cart created: ${cartId}`)

  // Step 2: Add line item
  const addItem = await api(`/store/carts/${cartId}/line-items`, "POST", {
    variant_id: variantId,
    quantity: qty,
  })
  if (!addItem.ok) throw new Error(`Add item failed: ${JSON.stringify(addItem.data)}`)
  console.log(`  ✓ Item added`)

  // Step 3: Update cart with customer info and shipping/billing address
  const address = {
    first_name: firstName,
    last_name: lastName,
    address_1: pick(ADDRESSES),
    city,
    province: "MH",
    postal_code: "400001",
    country_code: "in",
    phone,
  }
  const updateCart = await api(`/store/carts/${cartId}`, "POST", {
    email,
    shipping_address: address,
    billing_address: address,
  })
  if (!updateCart.ok) throw new Error(`Update cart failed: ${JSON.stringify(updateCart.data)}`)
  console.log(`  ✓ Address set`)

  // Step 4: Get shipping options
  const shippingOpts = await api(`/store/shipping-options?cart_id=${cartId}`)
  if (!shippingOpts.ok || !shippingOpts.data.shipping_options?.length) {
    throw new Error(`No shipping options: ${JSON.stringify(shippingOpts.data)}`)
  }
  const shippingOptionId = shippingOpts.data.shipping_options[0].id
  console.log(`  ✓ Shipping option: ${shippingOpts.data.shipping_options[0].name}`)

  // Step 5: Add shipping method
  const addShipping = await api(`/store/carts/${cartId}/shipping-methods`, "POST", {
    option_id: shippingOptionId,
  })
  if (!addShipping.ok) throw new Error(`Add shipping failed: ${JSON.stringify(addShipping.data)}`)
  console.log(`  ✓ Shipping method added`)

  // Step 6: Initialize payment collection
  const initPC = await api("/store/payment-collections", "POST", { cart_id: cartId })
  if (!initPC.ok) throw new Error(`Init payment collection failed: ${JSON.stringify(initPC.data)}`)
  const pcId = initPC.data.payment_collection.id
  console.log(`  ✓ Payment collection: ${pcId}`)

  // Step 7: Create payment session with Razorpay
  const createPS = await api(`/store/payment-collections/${pcId}/payment-sessions`, "POST", {
    provider_id: "pp_razorpay_razorpay",
  })
  if (!createPS.ok) throw new Error(`Payment session failed: ${JSON.stringify(createPS.data)}`)
  
  const session = createPS.data.payment_collection.payment_sessions?.find(
    s => s.provider_id?.includes("razorpay")
  )
  const rzpOrderId = session?.data?.razorpayOrder?.id
  const rzpAmount = session?.data?.razorpayOrder?.amount
  
  if (!rzpOrderId) throw new Error("No Razorpay order created")
  console.log(`  ✓ Razorpay order: ${rzpOrderId} (₹${rzpAmount / 100})`)

  // Step 8: Attempt to complete the cart
  // In test mode, Razorpay payments need the checkout.js flow.
  // We'll try cart completion - if auto-capture is enabled it may work.
  // Otherwise we'll note the Razorpay order ID for manual completion.
  const complete = await api(`/store/carts/${cartId}/complete`, "POST")
  
  if (complete.ok && complete.data.type === "order") {
    console.log(`  ✅ Order completed: #${complete.data.order.display_id}`)
    return { success: true, order: complete.data.order, cartId }
  }

  // Cart completion failed (payment not authorized yet)
  // This is expected — Razorpay requires user interaction for payment
  console.log(`  ⏳ Cart ready, awaiting payment authorization`)
  console.log(`     Razorpay Order: ${rzpOrderId}`)
  console.log(`     Amount: ₹${rzpAmount / 100}`)
  console.log(`     Card: 4111 1111 1111 1111 | Exp: 12/30 | CVV: 123`)
  
  return { 
    success: false, 
    pending: true, 
    cartId, 
    rzpOrderId,
    amount: rzpAmount,
    email,
    phone,
    sessionId: session.id,
  }
}

// ─── Main ───────────────────────────────────────────────────────
async function main() {
  console.log("╔═══════════════════════════════════════════════════╗")
  console.log("║  Bulk Order Script — Medusa + Razorpay Test Mode  ║")
  console.log("╚═══════════════════════════════════════════════════╝")
  console.log(`Target: ${ORDER_COUNT} orders`)
  console.log(`Backend: ${MEDUSA_URL}`)
  console.log(`Razorpay: ${RAZORPAY_KEY_ID} (test mode)`)
  console.log(`\nRazorpay Test Card: 4111 1111 1111 1111`)
  console.log(`Expiry: any future date | CVV: any 3 digits`)
  console.log("")

  const results = { 
    completed: 0, 
    pending: 0, 
    failed: 0, 
    completedOrders: [], 
    pendingCarts: [] 
  }

  for (let i = 1; i <= ORDER_COUNT; i++) {
    try {
      const result = await placeOrder(i)
      if (result.success) {
        results.completed++
        results.completedOrders.push(result.order.display_id || result.order.id)
      } else if (result.pending) {
        results.pending++
        results.pendingCarts.push({
          cartId: result.cartId,
          rzpOrderId: result.rzpOrderId,
          amount: result.amount,
        })
      }
    } catch (err) {
      results.failed++
      console.error(`  ❌ Failed: ${err.message}`)
    }
    // Small delay between orders
    if (i < ORDER_COUNT) await sleep(500)
  }

  console.log("\n╔═══════════════════════════════════════════════════╗")
  console.log("║                    RESULTS                        ║")
  console.log("╚═══════════════════════════════════════════════════╝")
  console.log(`  ✅ Completed: ${results.completed}`)
  console.log(`  ⏳ Pending:   ${results.pending} (need Razorpay checkout)`)
  console.log(`  ❌ Failed:    ${results.failed}`)
  
  if (results.completedOrders.length) {
    console.log(`\n  Completed order IDs: ${results.completedOrders.join(", ")}`)
  }
  
  if (results.pendingCarts.length) {
    console.log(`\n  ─── Pending Carts (need payment via checkout) ───`)
    console.log(`  To complete these, you can either:`)
    console.log(`  1. Use the storefront checkout with test card 4111 1111 1111 1111`)
    console.log(`  2. Use browser automation to open each cart's checkout`)
    console.log(``)
    for (const cart of results.pendingCarts) {
      console.log(`  Cart: ${cart.cartId} | Razorpay: ${cart.rzpOrderId} | ₹${cart.amount / 100}`)
    }
  }
}

main().catch(console.error)
