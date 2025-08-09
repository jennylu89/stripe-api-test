// api/create-intent.js
import Stripe from "stripe"
export const config = { runtime: "nodejs" }

export default async function handler(req, res) {
  // CORS (tighten Access-Control-Allow-Origin later)
  res.setHeader("Access-Control-Allow-Origin", "*")
  res.setHeader("Access-Control-Allow-Methods", "POST,OPTIONS,GET")
  res.setHeader("Access-Control-Allow-Headers", "Content-Type")
  if (req.method === "OPTIONS") return res.status(200).end()

  const key = process.env.STRIPE_SECRET_KEY || ""
  if (req.method === "GET") {
    return res.status(200).json({ ok: true, hasKey: !!key })
  }
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" })

  try {
    const stripe = new Stripe(key, { apiVersion: "2024-06-20" })

    const {
      email = "",
      name = "",
      phone = "",
      priceId = "",          // <-- pass this for catalog pricing
      amount,                // <-- optional fallback (cents)
      currency,              // <-- optional, used only if amount provided
      productName = "",
      productId = "",
    } = req.body || {}

    // Resolve price → amount/currency from Stripe if priceId is given
    let finalAmount = Number(amount || 0)
    let finalCurrency = (currency || "usd").toLowerCase()

    if (priceId) {
      const price = await stripe.prices.retrieve(priceId)
      if (!price.unit_amount || !price.currency) {
        return res.status(400).json({ error: "Price must be unit_amount-based (not metered/tiered)" })
      }
      finalAmount = price.unit_amount
      finalCurrency = price.currency
    }

    if (!finalAmount || finalAmount < 1) {
      return res.status(400).json({ error: "Invalid amount" })
    }

    // Upsert customer (optional but useful)
    let customerId
    if (email) {
      const existing = await stripe.customers.list({ email, limit: 1 })
      customerId = existing.data[0]
        ? (await stripe.customers.update(existing.data[0].id, { name, phone })).id
        : (await stripe.customers.create({ email, name, phone })).id
    }

    const pi = await stripe.paymentIntents.create({
      amount: finalAmount,
      currency: finalCurrency,
      customer: customerId,
      automatic_payment_methods: { enabled: true },
      receipt_email: email || undefined,
      metadata: { email, name, phone, productId, productName, priceId, source: "framer-payment-element" },
    })

    return res.status(200).json({ clientSecret: pi.client_secret })
  } catch (err) {
    return res.status(400).json({ error: err.message })
  }
}
