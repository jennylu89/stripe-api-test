// api/checkout.js
import Stripe from "stripe"
export const config = { runtime: "nodejs" }

function cors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*") // tighten to your domain in prod
  res.setHeader("Access-Control-Allow-Methods", "POST,OPTIONS,GET")
  res.setHeader("Access-Control-Allow-Headers", "Content-Type")
}

export default async function handler(req, res) {
  cors(res)
  if (req.method === "OPTIONS") return res.status(200).end()

  const key = process.env.STRIPE_SECRET_KEY || ""
  const stripe = key ? new Stripe(key, { apiVersion: "2024-06-20" }) : null

  // Health check
  if (req.method === "GET" && req.query?.debug === "1") {
    return res.status(200).json({
      ok: true,
      hasKey: !!key,
      keyPrefix: key ? key.slice(0, 7) : null, // "sk_test" / "sk_live"
      time: new Date().toISOString(),
      linkDisabled: String(process.env.DISABLE_LINK || "").toLowerCase() === "true",
    })
  }

  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" })
  if (!stripe) return res.status(400).json({ error: "Stripe key missing on server" })

  try {
    const {
      // identify what to sell
      priceId,
      productId,

      // lead info
      email = "",
      name = "",
      phone = "",

      // urls (fall back to env or sane defaults)
      successUrl = process.env.SUCCESS_URL || "https://your-site.com/success",
      cancelUrl = process.env.CANCEL_URL || "https://your-site.com/cancel",
      returnUrl = process.env.RETURN_URL || "https://your-site.com/thank-you",
    } = req.body || {}

    // ---- 1) Resolve a Price (from priceId or productId) ----
    let price
    if (priceId) {
      price = await stripe.prices.retrieve(priceId)
    } else if (productId) {
      const product = await stripe.products.retrieve(productId)
      const defaultPriceId =
        typeof product.default_price === "string"
          ? product.default_price
          : product.default_price?.id
      if (defaultPriceId) {
        price = await stripe.prices.retrieve(defaultPriceId)
      } else {
        const list = await stripe.prices.list({ product: product.id, active: true, limit: 1 })
        price = list.data[0]
      }
    } else {
      return res.status(400).json({ error: "Provide priceId or productId" })
    }
    if (!price) return res.status(400).json({ error: "No active price found" })

    const priceSummary = {
      amount: price.unit_amount || null,
      currency: price.currency || "usd",
      type: price.recurring ? "recurring" : "one_time",
      interval: price.recurring?.interval || null,
      interval_count: price.recurring?.interval_count || null,
      priceId: price.id,
      productId: price.product,
    }

    // ---- 2) Upsert Customer (so payments/receipts are tied to them) ----
    let customerId
    if (email) {
      const existing = await stripe.customers.list({ email, limit: 1 })
      customerId = existing.data[0]
        ? (await stripe.customers.update(existing.data[0].id, { name, phone })).id
        : (await stripe.customers.create({ email, name, phone })).id
    }

    // ---- 3) Branch on price type ----
    if (price.recurring) {
      // SUBSCRIPTION via Checkout Session (prefill email)
      const session = await stripe.checkout.sessions.create({
        mode: "subscription",
        line_items: [{ price: price.id, quantity: 1 }],
        customer: customerId,
        customer_email: customerId ? undefined : (email || undefined), // prefill when no customer
        customer_creation: "if_required",
        success_url: successUrl + "?session_id={CHECKOUT_SESSION_ID}",
        cancel_url: cancelUrl,
        allow_promotion_codes: true,
        metadata: { source: "framer", email, name, phone, productId: price.product, priceId: price.id },
      })
      return res.status(200).json({ mode: "subscription", url: session.url, priceSummary })
    }

    // ONE‑TIME via PaymentIntent (Payment Element)
    if (!price.unit_amount || !price.currency) {
      return res.status(400).json({ error: "Price must have unit_amount and currency" })
    }

    const disableLink = String(process.env.DISABLE_LINK || "").toLowerCase() === "true"

    const piParams = {
      amount: price.unit_amount,
      currency: price.currency,
      customer: customerId,
      receipt_email: email || undefined,
      metadata: { source: "framer", email, name, phone, productId: price.product, priceId: price.id },
      // Optional if you plan to charge again later:
      // setup_future_usage: "off_session",
    }

    // Choose how payment methods are offered
    const pi = await stripe.paymentIntents.create(
      disableLink
        ? { ...piParams, payment_method_types: ["card"] } // only card; Link/wallets off
        : { ...piParams, automatic_payment_methods: { enabled: true } } // Link & wallets on
    )

    return res.status(200).json({
      mode: "payment",
      clientSecret: pi.client_secret,
      returnUrl,
      priceSummary,
    })
  } catch (err) {
    return res.status(400).json({ error: err.message })
  }
}
