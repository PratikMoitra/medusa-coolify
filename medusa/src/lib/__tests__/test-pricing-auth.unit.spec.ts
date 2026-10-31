import {
  LOCKOUT_MS,
  MAX_FAILURES,
  WINDOW_MS,
  __resetTestPricingAttempts,
  clearTestPricingFailures,
  getTestPricingLockout,
  isEmailAllowed,
  readConfiguredTestShopPin,
  readTestEmailWhitelist,
  recordTestPricingFailure,
  verifyTestShopPin,
} from "../test-pricing-auth"

const PLACEHOLDER = "TEST_PIN_PLACEHOLDER_123"

describe("verifyTestShopPin", () => {
  it("accepts the configured TEST_SHOP_PIN (case/whitespace-insensitive)", () => {
    const env = { TEST_SHOP_PIN: PLACEHOLDER }
    expect(verifyTestShopPin(PLACEHOLDER, env)).toBe(true)
    expect(verifyTestShopPin(`  ${PLACEHOLDER.toLowerCase()} `, env)).toBe(true)
  })

  it("rejects wrong, empty, non-string and different-length candidates", () => {
    const env = { TEST_SHOP_PIN: PLACEHOLDER }
    expect(verifyTestShopPin("WRONG_PLACEHOLDER", env)).toBe(false)
    expect(verifyTestShopPin(PLACEHOLDER + "X", env)).toBe(false)
    expect(verifyTestShopPin("", env)).toBe(false)
    expect(verifyTestShopPin(undefined, env)).toBe(false)
    expect(verifyTestShopPin(null, env)).toBe(false)
    expect(verifyTestShopPin(12345 as unknown, env)).toBe(false)
    expect(verifyTestShopPin({ toString: () => PLACEHOLDER }, env)).toBe(false)
  })

  it("fails closed when TEST_SHOP_PIN is unset or empty", () => {
    expect(verifyTestShopPin("", {})).toBe(false)
    expect(verifyTestShopPin(PLACEHOLDER, {})).toBe(false)
    expect(verifyTestShopPin("", { TEST_SHOP_PIN: "" })).toBe(false)
    expect(verifyTestShopPin("", { TEST_SHOP_PIN: "   " })).toBe(false)
    expect(readConfiguredTestShopPin({ TEST_SHOP_PIN: "  " })).toBeNull()
  })

  it("ignores the removed TEST_MODE_CODE / NEXT_PUBLIC_TEST_SHOP_PIN fallbacks", () => {
    const env = {
      TEST_MODE_CODE: PLACEHOLDER,
      NEXT_PUBLIC_TEST_SHOP_PIN: PLACEHOLDER,
    }
    expect(verifyTestShopPin(PLACEHOLDER, env)).toBe(false)
  })
})

describe("email whitelist", () => {
  it("reads the same env fallbacks as before", () => {
    expect(readTestEmailWhitelist({ TEST_MODE_EMAILS: " A@x.test , b@x.test" })).toEqual([
      "a@x.test",
      "b@x.test",
    ])
    expect(readTestEmailWhitelist({ TEST_SHOP_ADMIN_EMAILS: "c@x.test" })).toEqual(["c@x.test"])
    expect(readTestEmailWhitelist({ NEXT_PUBLIC_TEST_SHOP_ADMIN_EMAILS: "d@x.test" })).toEqual([
      "d@x.test",
    ])
    expect(readTestEmailWhitelist({})).toEqual([])
  })

  it("empty whitelist allows any email; non-empty requires a match", () => {
    expect(isEmailAllowed(undefined, [])).toBe(true)
    expect(isEmailAllowed(" A@X.test ", ["a@x.test"])).toBe(true)
    expect(isEmailAllowed("z@x.test", ["a@x.test"])).toBe(false)
    expect(isEmailAllowed("", ["a@x.test"])).toBe(false)
    expect(isEmailAllowed(undefined, ["a@x.test"])).toBe(false)
  })
})

describe("per-IP rate limit", () => {
  beforeEach(() => __resetTestPricingAttempts())

  it(`locks an IP after ${MAX_FAILURES} failures and reports Retry-After`, () => {
    const t0 = 1_000_000
    for (let i = 0; i < MAX_FAILURES - 1; i++) recordTestPricingFailure("1.1.1.1", t0)
    expect(getTestPricingLockout("1.1.1.1", t0).locked).toBe(false)
    recordTestPricingFailure("1.1.1.1", t0)
    const lock = getTestPricingLockout("1.1.1.1", t0)
    expect(lock.locked).toBe(true)
    expect(lock.retryAfterSeconds).toBe(LOCKOUT_MS / 1000)
    // other IPs unaffected
    expect(getTestPricingLockout("2.2.2.2", t0).locked).toBe(false)
    // lock expires
    expect(getTestPricingLockout("1.1.1.1", t0 + LOCKOUT_MS).locked).toBe(false)
  })

  it("resets the failure window after WINDOW_MS", () => {
    const t0 = 2_000_000
    for (let i = 0; i < MAX_FAILURES - 1; i++) recordTestPricingFailure("3.3.3.3", t0)
    recordTestPricingFailure("3.3.3.3", t0 + WINDOW_MS + 1)
    expect(getTestPricingLockout("3.3.3.3", t0 + WINDOW_MS + 1).locked).toBe(false)
  })

  it("clears failures after a success", () => {
    const t0 = 3_000_000
    for (let i = 0; i < MAX_FAILURES - 1; i++) recordTestPricingFailure("4.4.4.4", t0)
    clearTestPricingFailures("4.4.4.4")
    recordTestPricingFailure("4.4.4.4", t0)
    expect(getTestPricingLockout("4.4.4.4", t0).locked).toBe(false)
  })
})
