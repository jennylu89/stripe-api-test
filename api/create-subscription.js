// api/create-subscription.js
import Stripe from "stripe"
export const config = { runtime: "nodejs" }

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*")
  res.setHeader("Access-Control-Allow-Methods", "POST,OPTIONS,GET")
  res.setHeader("Access-Control-Allow-Headers", "Content-Type")
  if (req.method === "OPTIONS") return res.status(200).end()

  const key = process.env.STRIPE_SECRET_KEY || ""
  if (req.method === "GET") return res.status(200).json({ ok: true, hasKey: !!key })
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" })

  try {
    const stripe = new Stripe(key, { apiVersion: "2024-06-20" })
    const {
      email = "",
      name = "",
      phone = "",
      priceId,                         // <-- recurring price_...
      successUrl = "https://your-site.com/success",
      cancelUrl = "https://your-site.com/cancel",
    } = req.body || {}

    if (!priceId) return res.status(400).json({ error: "Missing priceId" })

    // Optionally pre-create customer so email is attached
    let customer
    if (email) {
      const existing = await stripe.customers.list({ email, limit: 1 })
      customer = existing.data[0]
        ? await stripe.customers.update(existing.data[0].id, { name, phone })
        : await stripe.customers.create({ email, name, phone })
    }

    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      line_items: [{ price: priceId, quantity: 1 }],
      customer: customer?.id,
      customer_email: customer ? undefined : email || undefined,
      success_url: successUrl + "?session_id={CHECKOUT_SESSION_ID}",
      cancel_url: cancelUrl,
      allow_promotion_codes: true,
      metadata: { source: "framer-subscription", email, name, phone },
    })

    return res.status(200).json({ url: session.url })
  } catch (err) {
    return res.status(400).json({ error: err.message })
  }
}
