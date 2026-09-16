# Razorpay Storefront Integration Guide

This guide documents how to wire the `@alchemilla/medusa-razorpay` payment provider
into a **Next.js Medusa v2 storefront** (e.g. the Medusa Next.js Starter).

---

## 1. Install `react-razorpay` in the storefront

```bash
pnpm add react-razorpay
```

---

## 2. Add storefront environment variables

In your storefront `.env.local`:

```env
NEXT_PUBLIC_RAZORPAY_KEY_ID=rzp_test_xxx     # Same as RAZORPAY_ID on the backend
NEXT_PUBLIC_SHOP_NAME=Your Store Name
NEXT_PUBLIC_MEDUSA_BACKEND_URL=https://testmed.psmhome.no
```

---

## 3. Register Razorpay in `paymentInfoMap` (constants)

In `src/lib/constants.tsx`, add:

```tsx
export const paymentInfoMap = {
  // ... existing entries ...
  pp_razorpay_razorpay: {
    title: "Razorpay",
    icon: <CreditCard />,
  },
}

export const isRazorpay = (providerId?: string) =>
  providerId?.startsWith("pp_razorpay")
```

---

## 4. Create `razorpay-payment-button.tsx`

Create `src/modules/checkout/components/payment-button/razorpay-payment-button.tsx`:

```tsx
"use client"

import { placeOrder } from "@lib/data/cart"
import { HttpTypes } from "@medusajs/types"
import { Button } from "@modules/common/components/ui"
import { useRazorpay, RazorpayOrderOptions } from "react-razorpay"
import React, { useCallback, useState } from "react"
import ErrorMessage from "../error-message"

type Props = {
  cart: HttpTypes.StoreCart
  notReady: boolean
  "data-testid"?: string
}

const RazorpayPaymentButton: React.FC<Props> = ({ cart, notReady, "data-testid": dataTestId }) => {
  const [submitting, setSubmitting] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const { error, isLoading, Razorpay } = useRazorpay()

  const session = cart.payment_collection?.payment_sessions?.find(
    (s) => s.status === "pending" || s.status === "requires_more"
  )
  const razorpayOrder = session?.data?.razorpayOrder as Record<string, any> | undefined

  const handlePayment = useCallback(async () => {
    if (!razorpayOrder?.id || !session) return
    setSubmitting(true)

    // Place the Medusa order BEFORE opening the Razorpay modal.
    // This creates the order in the DB regardless of what happens in the modal.
    // The webhook updates payment status independently once payment completes.
    try {
      await placeOrder()
    } catch (err) {
      setErrorMessage((err as Error).message)
      setSubmitting(false)
      return
    }

    const options: RazorpayOrderOptions = {
      key: process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID || "",
      amount: Math.round(session.amount * 100),
      currency: (cart.currency_code?.toUpperCase() || "INR") as any,
      name: process.env.NEXT_PUBLIC_SHOP_NAME || "Your Store",
      description: `Order ${razorpayOrder.id}`,
      order_id: razorpayOrder.id,
      callback_url: `${process.env.NEXT_PUBLIC_MEDUSA_BACKEND_URL}/razorpay/callback`,
      redirect: true,
      prefill: {
        name: `${cart.billing_address?.first_name ?? ""} ${cart.billing_address?.last_name ?? ""}`.trim() || cart.email || "",
        email: cart.email ?? "",
        contact: cart.shipping_address?.phone ?? cart.billing_address?.phone ?? undefined,
        method: cart.currency_code === "inr" ? "upi" as any : undefined,
      },
      modal: {
        ondismiss: () => { setSubmitting(false); setErrorMessage("Payment cancelled") },
        escape: true,
        animation: true,
      },
    }

    const rzp = new Razorpay(options)
    rzp.on("payment.failed", (response: any) => {
      setErrorMessage(response.error?.description || "Payment failed")
      setSubmitting(false)
    })
    rzp.open()
  }, [Razorpay, razorpayOrder, session, cart])

  if (isLoading) return <Button disabled isLoading>Loading...</Button>
  if (error) return <Button disabled>Razorpay unavailable</Button>

  return (
    <>
      <Button
        disabled={notReady || submitting || !razorpayOrder?.id}
        onClick={handlePayment}
        size="large"
        isLoading={submitting}
        data-testid={dataTestId}
      >
        Pay with Razorpay
      </Button>
      <ErrorMessage error={errorMessage} data-testid="razorpay-payment-error-message" />
    </>
  )
}

export default RazorpayPaymentButton
```

---

## 5. Wire into `PaymentButton/index.tsx`

```tsx
import { isRazorpay } from "@lib/constants"
import RazorpayPaymentButton from "./razorpay-payment-button"

// Add inside the component switch:
if (isRazorpay(paymentSession?.provider_id)) {
  return (
    <RazorpayPaymentButton
      notReady={notReady}
      cart={cart}
      data-testid={dataTestId}
    />
  )
}
```

---

## 6. Razorpay Dashboard: Configure Webhook

1. **Dashboard → Settings → Webhooks → Add New Webhook**
2. **URL:** `https://testmed.psmhome.no/hooks/payment/razorpay_razorpay`
3. **Secret:** Create a strong secret → save as `RAZORPAY_WEBHOOK_SECRET` in Coolify
4. **Events:** `payment.authorized`, `payment.captured`, `payment.failed`

---

## 7. Required Coolify env vars for the Medusa service

| Variable | Where to find it |
|---|---|
| `RAZORPAY_ID` | Dashboard → Settings → API Keys → Key ID |
| `RAZORPAY_SECRET` | Dashboard → Settings → API Keys → Key Secret |
| `RAZORPAY_ACCOUNT` | Dashboard → Settings → Account & Billing → Account ID (`acc_...`) |
| `RAZORPAY_WEBHOOK_SECRET` | The secret you set in step 6 above |
| `STOREFRONT_URL` | Your storefront public URL (e.g. `https://your-store.com`) |

> **`RAZORPAY_ACCOUNT` is the most commonly missed.** Without it the plugin throws
> `razorpay_account is required` at startup and no Razorpay payments are possible.

---

## 8. Complete Checkout Flow

```
Customer selects Razorpay
  → Backend initiatePayment(): creates Razorpay order
  → Storefront: placeOrder() creates Medusa order
  → Storefront: Razorpay modal opens
  → Customer pays
  → Razorpay redirects browser → POST /razorpay/callback
  → Backend: verifies HMAC signature (order_id|payment_id)
  → Backend: redirects → ${STOREFRONT_URL}/order/confirmed?payment_id=...
  → Razorpay: POSTs webhook → /hooks/payment/razorpay_razorpay
  → Medusa: updates order payment status to "paid"
```
