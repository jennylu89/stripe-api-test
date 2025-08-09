import Stripe from "stripe"

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: "2024-06-20" })
const ALLOW_ORIGIN = process.env.ALLOW_ORIGIN || "*"

export default async function handler(req, res) {
  // CORS for Framer
  res.setHeader("Access-Control-Allow-Origin", ALLOW_ORIGIN)
  res.setHeader("Access-Control-Allow-Methods", "POST,OPTIONS")
  res.setHeader("Access-Control-Allow-Headers", "Content-Type")
  if (req.method === "OPTIONS") return res.status(200).end()
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" })

  try {
    const { name, email, phone } = req.body || {}
    if (!email) return res.status(400).json({ error: "Missing email" })

    // Find or create customer by email
    const existing = await stripe.customers.list({ email, limit: 1 })
    const base = { email, name, phone, metadata: { lead_name: name || "", lead_phone: phone || "" } }
    const customer = existing.data[0] ?? await stripe.customers.create(base)
    if (existing.data[0]) await stripe.customers.update(existing.data[0].id, base)

    // Create Stripe Checkout Session (prefilled via `customer`)
    const session = await stripe.checkout.sessions.create({
      mode: process.env.STRIPE_MODE || "payment", // "payment" or "subscription"
      customer: customer.id,
      line_items: [{ price: process.env.STRIPE_PRICE_ID, quantity: 1 }],
      phone_number_collection: { enabled: true },
      customer_update: { name: "auto", address: "auto" },
      success_url: (process.env.SUCCESS_URL || "https://example.com/thank-you") + "?session_id={CHECKOUT_SESSION_ID}",
      cancel_url: process.env.CANCEL_URL || "https://example.com/cancel",
    })

    return res.status(200).json({ url: session.url })
  } catch (err) {
    return res.status(400).json({ error: err.message })
  }
}
