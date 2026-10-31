/**
 * Server-only verification helpers for POST /store/carts/:id/test-pricing.
 *
 * Pure module (no Medusa runtime imports) so it can be unit-tested offline.
 *
 * - The PIN lives ONLY in the server-side env var `TEST_SHOP_PIN`. The old
 *   `TEST_MODE_CODE` and `NEXT_PUBLIC_TEST_SHOP_PIN` fallbacks are intentionally
 *   gone (a NEXT_PUBLIC_ value is by definition shipped to browsers).
 * - Fail closed: an unset/empty TEST_SHOP_PIN never matches anything.
 * - Constant-time compare: both sides are normalised (trim + upper-case, same
 *   case-insensitive semantics as before and as the storefront), hashed with
 *   SHA-256 so both buffers are always 32 bytes, then compared with
 *   crypto.timingSafeEqual.
 * - Brute-force protection: failed attempts are counted per client IP; after
 *   MAX_FAILURES failures inside WINDOW_MS the IP is locked out for LOCKOUT_MS.
 *   NOTE: this state is in-memory and PER INSTANCE (per Node process). With
 *   several replicas each keeps its own counters, and a restart clears them.
 *
 * Never log the submitted code or the configured PIN.
 */
import { createHash, timingSafeEqual } from "crypto"

export const MAX_FAILURES = 5
export const WINDOW_MS = 10 * 60_000
export const LOCKOUT_MS = 10 * 60_000
const MAX_TRACKED_IPS = 10_000

function normalize(value: string): string {
  return value.trim().toUpperCase()
}

function sha256(value: string): Buffer {
  return createHash("sha256").update(value, "utf8").digest()
}

/** Reads the configured PIN at call time. Returns null when not configured. */
export function readConfiguredTestShopPin(
  env: NodeJS.ProcessEnv = process.env
): string | null {
  const pin = (env.TEST_SHOP_PIN || "").trim()
  return pin ? pin : null
}

/**
 * True only if TEST_SHOP_PIN is configured and `candidate` matches it
 * (case-insensitive, surrounding whitespace ignored). Constant-time.
 */
export function verifyTestShopPin(
  candidate: unknown,
  env: NodeJS.ProcessEnv = process.env
): boolean {
  const pin = readConfiguredTestShopPin(env)
  const normalizedCandidate =
    typeof candidate === "string" ? normalize(candidate) : ""
  // Always hash and compare, even when unconfigured, so timing does not reveal state.
  const matches = timingSafeEqual(
    sha256(normalizedCandidate),
    sha256(pin ? normalize(pin) : "")
  )
  return pin !== null && normalizedCandidate.length > 0 && matches
}

/**
 * Comma-separated email whitelist (same env fallbacks as before; emails are not
 * secret, and dropping a fallback could silently empty the list = no restriction).
 */
export function readTestEmailWhitelist(
  env: NodeJS.ProcessEnv = process.env
): string[] {
  return (
    env.TEST_MODE_EMAILS ||
    env.TEST_SHOP_ADMIN_EMAILS ||
    env.NEXT_PUBLIC_TEST_SHOP_ADMIN_EMAILS ||
    ""
  )
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean)
}

/** Empty whitelist = no email restriction (previous behaviour). */
export function isEmailAllowed(
  email: unknown,
  whitelist: string[]
): boolean {
  if (whitelist.length === 0) return true
  const normalized = typeof email === "string" ? email.trim().toLowerCase() : ""
  return normalized.length > 0 && whitelist.includes(normalized)
}

interface AttemptEntry {
  failures: number
  windowStart: number
  lockedUntil: number
}

const attempts = new Map<string, AttemptEntry>()

function pruneAttempts(now: number) {
  if (attempts.size < MAX_TRACKED_IPS) return
  for (const [key, entry] of attempts) {
    if (entry.lockedUntil <= now && entry.windowStart + WINDOW_MS <= now) {
      attempts.delete(key)
    }
  }
  while (attempts.size >= MAX_TRACKED_IPS) {
    const oldest = attempts.keys().next()
    if (oldest.done) break
    attempts.delete(oldest.value)
  }
}

/** Is this IP currently locked out? */
export function getTestPricingLockout(
  ip: string,
  now: number = Date.now()
): { locked: boolean; retryAfterSeconds: number } {
  const entry = attempts.get(ip)
  if (entry && entry.lockedUntil > now) {
    return {
      locked: true,
      retryAfterSeconds: Math.ceil((entry.lockedUntil - now) / 1000),
    }
  }
  return { locked: false, retryAfterSeconds: 0 }
}

/** Record one failed attempt for this IP; locks the IP after MAX_FAILURES. */
export function recordTestPricingFailure(
  ip: string,
  now: number = Date.now()
): void {
  pruneAttempts(now)
  let entry = attempts.get(ip)
  if (!entry || entry.windowStart + WINDOW_MS <= now) {
    entry = {
      failures: 0,
      windowStart: now,
      lockedUntil: entry && entry.lockedUntil > now ? entry.lockedUntil : 0,
    }
    attempts.set(ip, entry)
  }
  entry.failures++
  if (entry.failures >= MAX_FAILURES) {
    entry.lockedUntil = now + LOCKOUT_MS
    entry.failures = 0
    entry.windowStart = now
  }
}

/** Clear failure state for this IP after a successful verification. */
export function clearTestPricingFailures(ip: string): void {
  attempts.delete(ip)
}

/** Test-only: reset all in-memory rate-limit state. */
export function __resetTestPricingAttempts(): void {
  attempts.clear()
}
