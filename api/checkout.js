// api/checkout.js
import Stripe from "stripe";
export const config = { runtime: "nodejs" };

function cors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*"); // lock to your domain later
  res.setHeader("Access-Control-Allow-Methods", "POST,OPTIONS,GET");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

export default async function handler(req, res) {
  cors(res);
  if (req.method === "OPTIONS") return res.status(200).end();

  const key = process.env.STRIPE_SECRET_KEY || "";
  if (req.method === "GET") {
    // Health check
    return res.status(200).json({ ok: true, hasKey: !!key });
  }
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    const stripe = new Stripe(key, { apiVersion: "2024-06-20" });

    const {
      // identifiers
      priceId,                // optional
      productId,              // optional (we'll use product.default_price when available)
      // customer/lead
      email = "",
      name = "",
      phone = "",
      // URLs
      successUrl = "https://your-site.com/success",
      cancelUrl = "https://your-site.com/cancel",
      returnUrl = "https://your-site.com/thank-you",
    } = req.body || {};

    // ---- 1) Resolve a Price ----
    let price;
    if (priceId) {
      price = await stripe.prices.retrieve(priceId);
    } else if (productId) {
      const product = await stripe.products.retrieve(productId);
      if (product.default_price) {
        price = await stripe.prices.retrieve(
          typeof product.default_price === "string" ? product.default_price : product.default_price.id
        );
      } else {
        // fallback: grab the first active price on the product
        const list = await stripe.prices.list({ product: productId, active: true, limit: 1 });
        price = list.data[0];
      }
    } else {
      return res.status(400).json({ error: "Provide priceId or productId" });
    }

    if (!price) return res.status(400).json({ error: "No active price found" });

    // ---- 2) Upsert a Customer (handy for lead capture) ----
    let customerId;
    if (email) {
      const existing = await stripe.customers.list({ email, limit: 1 });
      customerId = existing.data[0]
        ? (await stripe.customers.update(existing.data[0].id, { name, phone })).id
        : (await stripe.customers.create({ email, name, phone })).id;
    }

    // ---- 3) Branch by price type ----
    // Recurring price => Subscription (via Checkout Session)
    if (price.recurring) {
      const session = await stripe.checkout.sessions.create({
        mode: "subscription",
        line_items: [{ price: price.id, quantity: 1 }],
        customer: customerId,
        customer_email: customerId ? undefined : email || undefined,
        success_url: successUrl + "?session_id={CHECKOUT_SESSION_ID}",
        cancel_url: cancelUrl,
        allow_promotion_codes: true,
        metadata: { source: "framer-unified", email, name, phone, priceId: price.id, productId: price.product },
      });
      return res.status(200).json({ mode: "subscription", url: session.url });
    }

    // One-time price => Payment Element (PaymentIntent)
    if (!price.unit_amount || !price.currency) {
      return res.status(400).json({ error: "Price must have unit_amount and currency" });
    }

    const pi = await stripe.paymentIntents.create({
      amount: price.unit_amount,
      currency: price.currency,
      customer: customerId,
      automatic_payment_methods: { enabled: true },
      receipt_email: email || undefined,
      metadata: { source: "framer-unified", email, name, phone, priceId: price.id, productId: price.product },
    });

    return res.status(200).json({ mode: "payment", clientSecret: pi.client_secret, returnUrl });
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
}
