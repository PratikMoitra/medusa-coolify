# Fix: Auto-load .env & Skip Re-prompting

## Problem

`interactiveSetup()` checks `process.env.MEDUSA_BACKEND_URL` etc., but the script never
loads the `.env` file — so those variables are always `undefined` at runtime, causing it
to fall through to interactive prompts every time, even when the file has all credentials.

## Root Cause

No `dotenv` (or equivalent) call exists in `woo-to-medusa.ts`.
The script is ESM + `tsx`, so `dotenv/config` can't be imported as a side-effect easily —
but we can use Node's built-in `--env-file` flag (Node ≥ 20, which is already required).

## Proposed Changes

### 1. Load `.env` automatically via Node `--env-file`

Update all `npm run` scripts in `package.json` to pass `--env-file ../.env` (or `.env`)
to `tsx` via `NODE_OPTIONS`, OR use tsx's `--env-file` passthrough flag.

The cleanest approach: update each script to use `tsx --env-file .env woo-to-medusa.ts`.
tsx ≥ 4.x passes unknown flags to Node, and Node ≥ 20 understands `--env-file`.

### 2. Silent config display — no prompts if all vars are set

Refactor `interactiveSetup()` to:
- Load each value from env first
- Only prompt for values that are missing/empty
- Print a summary of what was loaded from env (so user can see + override if needed)
- If ALL six values are present → print summary and skip all prompts entirely

### 3. Image handling (no change needed)

The script already:
- Downloads from WooCommerce, uploads via `POST /admin/uploads`
- Medusa handles the R2 push internally — no R2 vars needed in the migration script
- `checkUploadsEndpoint()` smoke-tests this before the run
- `migration-images-cache.json` deduplicates across runs

No R2 vars are needed here — Medusa's own env handles that.

## Files Changed

- `package.json` — add `--env-file .env` to all tsx invocations
- `woo-to-medusa.ts` — refactor `interactiveSetup()` to skip prompts when vars are set
- `.env.template` — no change needed
