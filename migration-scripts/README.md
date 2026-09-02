# Migration Scripts

WooCommerce → Medusa v2 migration tooling. Lives alongside the Medusa deployment but is not part of the production container.

## Setup

```bash
cd migration-scripts
cp .env.template .env
# Fill in your credentials in .env
npm install
```

## Run

```bash
# Dry run first — preview what would happen (no writes)
npm run migrate:dry

# Run the real migration
npm run migrate

# Re-migrate products already in Medusa (use if fixing data)
npm run migrate:force

# Skip R2 image uploads (keep WooCommerce image URLs)
npm run migrate:images-skip

# Fix category mappings on already-migrated products (safe to re-run)
npm run migrate:categories
```

Or run directly with env vars:

```bash
MEDUSA_BACKEND_URL=https://... MEDUSA_ADMIN_EMAIL=admin@... MEDUSA_ADMIN_PASSWORD=... \
WOOCOMMERCE_URL=https://... WOOCOMMERCE_CONSUMER_KEY=ck_... WOOCOMMERCE_CONSUMER_SECRET=cs_... \
npx tsx woo-to-medusa.ts --dry-run
```

## What it does

| Phase | Action |
|---|---|
| Setup | Prompts for all credentials (falls back to .env / env vars) |
| Auth | Authenticates with Medusa admin API |
| Region | Ensures India/INR region exists |
| Sales channel | Lists existing channels to pick from, or creates a new one |
| Categories | Syncs WooCommerce categories → Medusa product categories (idempotent) |
| Products | Migrates all published products with variants, prices, dimensions |
| Images | Checks R2 first (by SHA-256 key) — uploads only if not already there |
| Tags | Creates missing product tags on the fly |
| Assignment | Batch-assigns all new products to the selected sales channel |

## R2 Image Deduplication

Images are stored in R2 under a stable key:
```
woo-migration/<sha256-of-url[0:12]>-<original-filename>
```

On each run, the script checks if the key already exists in R2 before downloading. This means:
- Running the migration twice will **not** re-upload images
- Safe to use `--force` to re-create products without wasting bandwidth

## CLI Flags

| Flag | Effect |
|---|---|
| `--dry-run` | Preview only — no writes to Medusa |
| `--force` | Re-migrate products that already exist in Medusa |
| `--skip-images` | Use WooCommerce image URLs directly (no R2 upload) |
| `--patch-categories` | Only patch categories onto existing Medusa products (no product sync) |
| `--verbose` | Log every API call and full payloads |
