/**
 * Shared Shiprocket API authentication helper.
 * Caches the token in-memory (valid ~10 days) and refreshes on 401.
 */

let cachedToken: string | null = null
let tokenExpiresAt = 0

const SR_BASE = "https://apiv2.shiprocket.in/v1/external"

export async function getShiprocketToken(): Promise<string> {
  if (cachedToken && Date.now() < tokenExpiresAt) {
    return cachedToken
  }

  const email = process.env.SHIPROCKET_EMAIL
  const password = process.env.SHIPROCKET_PASSWORD

  if (!email || !password) {
    throw new Error("SHIPROCKET_EMAIL and SHIPROCKET_PASSWORD env vars are required")
  }

  const res = await fetch(`${SR_BASE}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  })

  const data = await res.json() as { token?: string }
  if (!data.token) {
    throw new Error(`Shiprocket auth failed: ${JSON.stringify(data)}`)
  }

  cachedToken = data.token
  tokenExpiresAt = Date.now() + 9 * 24 * 60 * 60 * 1000
  return cachedToken
}

export async function shiprocketFetch<T = Record<string, unknown>>(
  path: string,
  options: {
    method?: string
    body?: Record<string, unknown>
    params?: Record<string, string>
  } = {}
): Promise<T> {
  const token = await getShiprocketToken()

  let url = `${SR_BASE}${path}`
  if (options.params) {
    const qs = new URLSearchParams(options.params).toString()
    url += `?${qs}`
  }

  const doFetch = async (authToken: string) => {
    const res = await fetch(url, {
      method: options.method || "GET",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${authToken}`,
      },
      body: options.body ? JSON.stringify(options.body) : undefined,
    })
    return res
  }

  let res = await doFetch(token)

  if (res.status === 401) {
    cachedToken = null
    tokenExpiresAt = 0
    const newToken = await getShiprocketToken()
    res = await doFetch(newToken)
  }

  return res.json() as Promise<T>
}

export function getPickupPostcode(): string {
  return process.env.SHIPROCKET_PICKUP_POSTCODE || "560064"
}
