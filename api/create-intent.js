// api/create-intent.js
import Stripe from "stripe";

// Force Node runtime (not Edge)
export const config = { runtime: "nodejs" };

export default async function handler(req, res) {
  // Basic CORS for browser calls (Framer)
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST,OPTIONS,GET");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();

  const key = process.env.STRIPE_SECRET_KEY || "";

  // Quick debug GET (safe to leave while testing)
  if (req.method === "GET") {
    return res.status(200).json({
      ok: true,
      hasKey: !!key,
      prefix: key ? key.slice(0, 7) : null, // e.g., "sk_test" or "sk_live"
    });
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    // ⬅️ IMPORTANT: initialize Stripe *inside* the request using the env var
    const stripe = new Stripe(key, { apiVersion: "2024-06-20" });

    const { email = "", name = "", phone = "", amount = 5000, currency = "usd" } = req.body || {};

    // (optional) upsert a customer
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
      metadata: { email, name, phone, source: "framer" },
    });

    return res.status(200).json({ clientSecret: pi.client_secret });
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
}
