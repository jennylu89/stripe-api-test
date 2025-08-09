// api/create-intent.js
import Stripe from "stripe";

// Keep Node runtime (not Edge)
export const config = { runtime: "nodejs" };

export default async function handler(req, res) {
  // CORS for browser calls (tighten ALLOW_ORIGIN later)
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST,OPTIONS,GET");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();

  const key = process.env.STRIPE_SECRET_KEY || "";

  // Quick health check (ok to keep while testing)
  if (req.method === "GET") {
    return res.status(200).json({
      ok: true,
      hasKey: !!key,
      mode: key?.startsWith("sk_live_") ? "live" : "test",
    });
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const {
      email = "",
      name = "",
      phone = "",
      // product info from Framer
      productId = "",
      productName = "Product",
      image = "",
      // price
      amount = 5000, // cents
      currency = "usd",
    } = req.body || {};

    if (!Number(amount) || Number(amount) < 1) {
      return res.status(400).json({ error: "Invalid amount (in cents)" });
    }

    // Initialize Stripe *inside* the handler
    const stripe = new Stripe(key, { apiVersion: "2024-06-20" });

    // (Optional) upsert a customer so you keep leads if they abandon
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

    // Create the PaymentIntent for Payment Element
    const pi = await stripe.paymentIntents.create({
      amount: Number(amount),
      currency: String(currency).toLowerCase(),
      customer: customerId,
      automatic_payment_methods: { enabled: true },
      receipt_email: email || undefined,
      metadata: {
        email, name, phone,
        productId, productName, image,
        source: "framer-payment-element",
      },
    });

    return res.status(200).json({ clientSecret: pi.client_secret });
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
}
