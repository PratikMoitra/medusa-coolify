---
name: medusa-product-upload
description: >-
  Bulk-upload products to the ChamkileyStore MedusaJS v2 backend using the
  zero-dependency CSV upload script and verify post-upload configuration
  (shipping profiles, sales channels, pricing, weights, variant titles).
  Use when the user wants to add new products, create product CSVs, run the
  upload script, or troubleshoot product/checkout issues related to missing
  shipping profiles, unpublished products, or incorrect variant data.
---

# MedusaJS Product Upload & Configuration

## Deployment Setup

> [!IMPORTANT]
> Always follow this branching strategy. Never push test changes to production branches.

| Environment    | Component        | Repo                                            | Branch          |
|----------------|------------------|-------------------------------------------------|-----------------|
| **Test**       | Storefront       | `PratikMoitra/chamkiley-store-v2`               | `test`          |
| **Test**       | Medusa Backend   | `PratikMoitra/medusa-coolify`                   | `integration`   |
| **Production** | Storefront       | `PratikMoitra/chamkiley-store-v2`               | `main`          |
| **Production** | Medusa Backend   | `PratikMoitra/medusa-coolify`                   | `main`          |

**Workflow:** Test on `test`/`integration` → PR to `main` for production.

**Coolify:** No webhook trigger — manual deploy required from the Coolify dashboard.

### Key URLs

| Environment | Medusa Backend             | Storefront                     |
|-------------|----------------------------|--------------------------------|
| Test        | `https://testmed.psmhome.no` | `https://test.chamkileystore.in` |
| Production  | `https://medusajs.psmhome.no`| `https://chamkileystore.in`     |

### Credentials

- Admin email: `pratik@onezipp.com`
- Auth: `POST /auth/user/emailpass` → returns `{token}` → use as `Authorization: Bearer <token>`
- Publishable key: `pk_05c172563f4766d8160ce4211e9795f21d688bd3586e8d77cea54423fab3ca57`
- Sales channel: `sc_01M1EMNPMSMQ174KHEW4G79HGJ` ("Chamkileystore")

---

## 1. CSV Format

CSV location: `product-uploads/<category-name>.csv`

### Required Columns

```
handle, title, description, subtitle, sku, price, compare_price,
option1_name, option1_value, option2_name, option2_value,
option3_name, option3_value, images, category, tags, status,
stock_qty, weight
```

### Rules

- First row for a `handle` must have `title`, `description`, `subtitle`, `images`, `category`
- Subsequent rows for the same handle are additional variants (leave title/description empty)
- `price` is in INR (flat, no paise conversion)
- `weight` is in grams
- `images` is a pipe-separated list of URLs
- `tags` is pipe-separated (e.g., `new|couple|bengali`)
- `status`: `published` or `draft`

### Couple Products — 3-Axis Options

Couple products use 3 option axes: `His Size`, `Her Size`, `Color`.
Each combo is a separate variant = 5 × 5 × 1 = 25 variants per product per color.

Sizes: `S, M, L, XL, XXL`

Example row:
```csv
my-better-half,My Better Half Couple T-Shirt Set,"Description...",Subtitle,CS-MBH-BLK-HS-HM,1199,1500,His Size,S,Her Size,M,Color,Black,"img1.webp|img2.webp",Couple,new|couple,published,50,420
```

### Single Products — 2-Axis Options

Standard products use: `Color`, `Size`. One variant per combo.

---

## 2. Upload Script

**Location:** `scripts/upload-products.mjs`

### Prerequisites

- Node.js 18+ (zero npm dependencies — uses built-in modules only)
- `.env.local` (or `.env`) in the repo root with:

```env
MEDUSA_BACKEND_URL=https://testmed.psmhome.no
MEDUSA_ADMIN_EMAIL=pratik@onezipp.com
MEDUSA_ADMIN_PASSWORD=<password>
```

### Run

```bash
cd /path/to/medusa-coolify
node scripts/upload-products.mjs product-uploads/<file>.csv
```

### What It Does

1. Authenticates with Medusa Admin API
2. Parses CSV, groups rows by `handle`
3. Creates products with options, variants, prices, and images
4. Assigns to sales channel `sc_01M1EMNPMSMQ174KHEW4G79HGJ`
5. Publishes products (if `status=published`)
6. Sets inventory/stock levels
7. Falls back to direct R2 upload if Medusa `/admin/uploads` returns 500

### R2 Configuration

- Public URL: `https://media.chamkileystore.in` (MUST be HTTPS)
- Bucket: `csstagingbucket`
- R2 env vars (in `.env.local`): `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_ENDPOINT`, `R2_BUCKET`

---

## 3. Post-Upload Checklist

> [!CAUTION]
> Skipping any of these steps will cause checkout failures.

### 3.1 Shipping Profile

Products **must** be on the `Shiprocket` shipping profile (`sp_01M255NB1QG47M8MVC9NB9Z2PK`).
The upload script assigns the `Default Shipping Profile` — this must be corrected.

**Fix via API:**
```bash
curl -X POST "$MEDUSA_URL/admin/products/$PRODUCT_ID" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"shipping_profile_id": "sp_01M255NB1QG47M8MVC9NB9Z2PK"}'
```

**Why:** The `Shiprocket-Std` shipping option is linked to the Shiprocket profile.
If a product is on a different profile, cart completion fails with:
> "The cart items require shipping profiles that are not satisfied by the current shipping methods"

### 3.2 Variant Titles (Couple Products)

Update variant titles to include `His:` / `Her:` prefixes for clear fulfillment labeling.

**Before:** `S / M / Black`
**After:** `His: S / Her: M / Black`

```bash
curl -X POST "$MEDUSA_URL/admin/products/$PID/variants/$VID" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"title": "His: S / Her: M / Black"}'
```

### 3.3 Weights (Couple Products)

Couple products ship 2 tees per set. Weight must be 2× single product weight.
- Single tee: 210g
- Couple set: **420g**

Verify:
```bash
curl -H "Authorization: Bearer $TOKEN" \
  "$MEDUSA_URL/admin/products/$PID?fields=variants.id,variants.title,variants.weight"
```

### 3.4 Product Metadata (Couple Products)

Add metadata for storefront couple detection:
```json
{
  "couple_set": true,
  "items_per_set": 2,
  "fulfillment_note": "COUPLE SET: Pack 2 t-shirts per order — 1 His size + 1 Her size. Check variant title for sizes."
}
```

```bash
curl -X POST "$MEDUSA_URL/admin/products/$PID" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"metadata": {"couple_set": true, "items_per_set": 2, "fulfillment_note": "COUPLE SET: Pack 2 t-shirts per order — 1 His size + 1 Her size. Check variant title for sizes."}}'
```

### 3.5 Sales Channel

Verify products are in the `Chamkileystore` sales channel:
```bash
curl -H "Authorization: Bearer $TOKEN" \
  "$MEDUSA_URL/admin/products/$PID?fields=sales_channels.id,sales_channels.name"
```

### 3.6 Verify Store API Visibility

```bash
curl -H "x-publishable-api-key: $PK" \
  "$MEDUSA_URL/store/products?handle=my-product-handle"
```

If empty, the product is either not published, not in the sales channel, or missing pricing.

---

## 4. Shipping Configuration

### Shipping Option

- **Name:** `Shiprocket-Std`
- **ID:** `so_01M259PMHENWZG36PB1BWMYV5T`
- **Profile:** `sp_01M255NB1QG47M8MVC9NB9Z2PK` (Shiprocket)

### Price Rules (Conditional Shipping)

Shipping cost is controlled via price rules on the shipping option, NOT a separate free shipping option.

| Condition | Amount |
|-----------|--------|
| `item_total ≤ 999` | ₹100 |
| `item_total ≥ 1000` | ₹0 (free) |

**Update shipping prices:**
```bash
curl -X POST "$MEDUSA_URL/admin/shipping-options/so_01M259PMHENWZG36PB1BWMYV5T" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "prices": [
      {"id": "<paid_price_id>", "amount": 100, "currency_code": "inr",
       "rules": [{"attribute": "item_total", "value": 999, "operator": "lte"}]},
      {"id": "<free_price_id>", "amount": 0, "currency_code": "inr",
       "rules": [{"attribute": "item_total", "value": 1000, "operator": "gte"}]}
    ]
  }'
```

> [!NOTE]
> The `rules` array uses numeric `value` (not string). Each rule needs `attribute`, `value`, and `operator`.

### Backend Endpoint: `/custom/shipping-info`

Located at `medusa/src/api/custom/shipping-info/route.ts`. The storefront `ShippingProgress` component fetches from this endpoint. It reads `prices.price_rules` to detect conditional pricing and returns tier data.

---

## 5. Checkout Flow & Common Errors

### Payment Flow

1. Storefront → `POST /api/checkout/init` → creates Medusa cart + Razorpay order
2. User pays via Razorpay widget
3. Storefront → `POST /api/checkout/complete` → Medusa `POST /store/carts/{id}/complete`
4. Medusa calls Razorpay plugin `authorizePayment()` → polls Razorpay for order status
5. If `order.status === "paid"` → `AUTHORIZED` → order created

### Error: "Unable to complete the Medusa cart"

**Possible causes (check in order):**

1. **Shipping profile mismatch** — Product on wrong profile (see §3.1)
   - Error: `"The cart items require shipping profiles that are not satisfied by the current shipping methods"`
2. **Payment not authorized** — Razorpay hasn't transitioned to `paid` yet
   - Error: `"Session was not authorized with the provider"`
   - Fix: Retry logic in `apps/storefront/app/api/checkout/complete/route.ts`
3. **Variant not published or priced** — Product not in sales channel or missing price
   - Error: `"Variants with IDs ... do not exist or belong to a product that is not published"`
   - or: `"Variants with IDs ... do not have a price"`

### Error: Shipping shows wrong amount in cart

The `ShippingProgress` component fetches from `/custom/shipping-info`. If the endpoint doesn't read `prices.price_rules`, it returns a flat rate. Ensure the endpoint code includes `prices.price_rules.*` in the `query.graph` fields.

---

## 6. Region & Payment Provider

| Item | Value |
|------|-------|
| Region ID | `reg_01M1A2Y6ESG7AT7V602M2FMQBP` |
| Region Name | IND |
| Currency | INR |
| Payment Provider | `pp_razorpay_razorpay` |
| Razorpay Plugin | `@alchemilla/medusa-razorpay@0.1.0` (patched) |
| Auto-capture | `true` |

---

## 7. Constraints

- **Zero dependencies** for the upload script (built-in Node.js modules only)
- **INR only** — single currency store
- **No emojis** in storefront UI
- **50 stock per variant** default
- **Test first, then production** — always validate on test before PR to main
- **Price stays flat** per product regardless of size/color combo
- **Couple weight = 2 × single weight** (420g for couple, 210g for single)

