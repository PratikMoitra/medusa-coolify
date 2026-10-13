# Razorpay & Pricing — Critical Rules

## Currency Units

**MedusaJS v2 stores amounts in RUPEES (major units). Razorpay expects PAISE (smallest unit).**

| MedusaJS amount | Razorpay amount | Actual price |
|----------------|-----------------|--------------|
| `749` | `74900` | ₹749 |
| `1` | `100` | ₹1 |
| `100` | `10000` | ₹100 |

The `@alchemilla/medusa-razorpay` plugin's `getToPay()` method handles this conversion via `getSmallestUnit(amount, currency_code)`.

## DO NOT modify `getToPay()`

The `getToPay()` method in `razorpay-base.js` MUST call `getSmallestUnit()`:

```javascript
// ✅ CORRECT
getToPay(amount, currency_code) {
    return getSmallestUnit(amount, currency_code);
}

// ❌ WRONG — causes 100x undercharge (sends rupees as paise)
getToPay(amount, _currency_code) {
    return Number(amount);
}
```

**History:** A previous patch bypassed `getSmallestUnit()` claiming "MedusaJS v2 already provides paise." This was empirically proven false — MedusaJS v2 provides RUPEES. The bypass caused customers to be charged ₹8.49 instead of ₹849. Fixed in commit `9bb7cfe` (Oct 2026).

## Patch File

`medusa/patches/@alchemilla__medusa-razorpay@0.1.0.patch` contains bug fixes for:
1. `_normalizePayments()` — Razorpay SDK returns `{ items: [...] }` not a plain array
2. `.count` → `.length` — standard JS array property
3. `capturedPayments` fallback — for `auto_capture: true` mode
4. All `fetchPayments()` calls wrapped with `_normalizePayments()`

The patch does NOT (and must not) modify `getToPay()`.

## Razorpay Minimums

- Minimum order: **100 paise (₹1)**
- Orders below ₹1 will be rejected with `BAD_REQUEST_ERROR`
