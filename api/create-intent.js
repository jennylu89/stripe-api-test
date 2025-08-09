import Stripe from "stripe";
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: "2024-06-20" });

export default async function handler(req, res) {
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    const { email = "", name = "", phone = "", amount = 5000, currency = "usd" } = req.body || {};

    // (optional) upsert customer so the lead is saved
    let customerId;
    if (email) {
      const existing = await stripe.customers.list({ email, limit: 1 });
      if (existing.data[0]) {
        const u = await stripe.customers.update(existing.data[0].id, { name, phone });
        customerId = u.id;
      } else {
        const c = await stripe.customers.create({ email, name, phone });
        customerId = c.id;
      }
    }

    const pi = await stripe.paymentIntents.create({
      amount,
      currency,
      customer: customerId,
      automatic_payment_methods: { enabled: true },
      receipt_email: email || undefined,
      metadata: { email, name, phone, source: "framer" }
    });

    res.status(200).json({ clientSecret: pi.client_secret });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
}
// TEMP DEBUG — remove later
export default async function handler(req, res) {
  if (req.method === "GET") {
    return res.status(200).json({
      ok: true,
      hasKey: !!process.env.STRIPE_SECRET_KEY,
      // mode is safe to reveal; it doesn't leak the key
      mode: process.env.STRIPE_SECRET_KEY?.startsWith("sk_live_") ? "live" : "test",
    })
  }

  // ... your existing POST code ...
}
